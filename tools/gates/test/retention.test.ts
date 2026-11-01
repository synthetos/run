/**
 * Asset retention across deploys (ROADMAP P0-04, RUN_PLAN §6.3) and the
 * selection of a trusted previous deployment.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPreviousRun, selectPreviousRun } from '../src/deploy/previous.ts';
import {
  type FileBytes,
  formatState,
  isHashedAsset,
  mergeRetained,
  parseState,
  RETENTION_MS,
  RetentionError,
  type RetentionState,
  sha256,
} from '../src/deploy/retention.ts';
import { REPO_ROOT } from './scratch.ts';

const enc = new TextEncoder();
const f = (path: string, text: string): FileBytes => ({ path, bytes: enc.encode(text) });
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const T0 = new Date('2026-11-01T00:00:00Z');
const later = (ms: number): Date => new Date(T0.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;

const OLD_JS = f('assets/workspace-AAAAAAAA.js', 'old');
const NEW_JS = f('assets/workspace-BBBBBBBB.js', 'new');
const FONT = f('assets/IBMPlexSans-Regular-Latin1-CCCCCCCC.woff2', 'font');

/** Deploys `site` on top of `previous` and returns the result. */
function deploy(site: FileBytes[], now: Date, commit: string, previous: { state: RetentionState; files: FileBytes[] } | null, env = 'production') {
  return mergeRetained({ env, commit, now, site, previous });
}

/** The files the next deploy would download: every asset the state lists. */
function stateFiles(site: FileBytes[], retained: readonly FileBytes[], state: RetentionState): FileBytes[] {
  return [...site, ...retained].filter((x) => x.path in state.assets);
}

describe('isHashedAsset', () => {
  it.each(['assets/workspace-BxrBSiSp.js', 'assets/base-Bpk9PVYM.css', 'assets/cloud/cloud-a_b-C9d.js'.replace('C9d', 'C9dEfGhI'), 'assets/IBMPlexMono-Medium-Latin1-CfBEoGIJ.woff2'])(
    'accepts %s',
    (p) => {
      expect(isHashedAsset(p)).toBe(true);
    },
  );
  it.each(['index.html', '_headers', 'assets/workspace.js', 'licenses/IBM-Plex-OFL.txt', 'assets/../index-AAAAAAAA.js', 'assets/x-AAAA.js'])('refuses %s', (p) => {
    expect(isHashedAsset(p)).toBe(false);
  });
});

describe('mergeRetained', () => {
  const html = (v: string): FileBytes => f('index.html', `<script src="/assets/workspace-${v}.js">`);
  const first = deploy([html('AAAAAAAA'), OLD_JS, FONT, f('_headers', 'h')], T0, COMMIT_A, null);

  it('the first deploy records only hashed assets as current', () => {
    expect(first.retained).toEqual([]);
    expect(Object.keys(first.state.assets)).toEqual([FONT.path, OLD_JS.path]);
    expect(first.state.assets[OLD_JS.path]).toEqual({ sha256: sha256(OLD_JS.bytes), lastCurrent: T0.toISOString(), commit: COMMIT_A });
  });

  const site2 = [html('BBBBBBBB'), NEW_JS, FONT, f('_headers', 'h')];
  const prev1 = { state: first.state, files: stateFiles([OLD_JS, FONT], [], first.state) };

  it('keeps a replaced asset for 14 days after it stopped being current, and never the old HTML', () => {
    const r = deploy(site2, later(DAY), COMMIT_B, prev1);
    expect(r.retained.map((x) => x.path)).toEqual([OLD_JS.path]);
    expect(r.state.assets[OLD_JS.path]?.lastCurrent).toBe(T0.toISOString());
    expect(r.state.assets[NEW_JS.path]?.lastCurrent).toBe(later(DAY).toISOString());
    expect(r.state.assets[FONT.path]?.lastCurrent).toBe(later(DAY).toISOString());
    expect(r.retained.some((x) => x.path === 'index.html')).toBe(false);
  });

  it('drops it once 14 days have passed since it was last current', () => {
    const r = deploy(site2, later(RETENTION_MS), COMMIT_B, prev1);
    expect(r.retained).toEqual([]);
    expect(r.expired).toEqual([OLD_JS.path]);
    expect(OLD_JS.path in r.state.assets).toBe(false);
    const justBefore = deploy(site2, later(RETENTION_MS - 1), COMMIT_B, prev1);
    expect(justBefore.retained.map((x) => x.path)).toEqual([OLD_JS.path]);
  });

  it('measures age from the last deploy where the asset was current, not from its first appearance', () => {
    // OLD_JS stays current in a second deploy 20 days later, then is replaced.
    const second = deploy([html('AAAAAAAA'), OLD_JS, FONT], later(20 * DAY), COMMIT_A, prev1);
    const prev2 = { state: second.state, files: stateFiles([OLD_JS, FONT], second.retained, second.state) };
    const third = deploy(site2, later(21 * DAY), COMMIT_B, prev2);
    expect(third.retained.map((x) => x.path)).toEqual([OLD_JS.path]);
  });

  it('carries a retained asset through further deploys until it ages out', () => {
    const r2 = deploy(site2, later(DAY), COMMIT_B, prev1);
    const prev2 = { state: r2.state, files: stateFiles(site2, r2.retained, r2.state) };
    const r3 = deploy(site2, later(10 * DAY), COMMIT_B, prev2);
    expect(r3.retained.map((x) => x.path)).toEqual([OLD_JS.path]);
    const prev3 = { state: r3.state, files: stateFiles(site2, r3.retained, r3.state) };
    expect(deploy(site2, later(15 * DAY), COMMIT_B, prev3).expired).toEqual([OLD_JS.path]);
  });

  it('refuses state from the other environment: bench assets never reach production', () => {
    expect(() => deploy(site2, later(DAY), COMMIT_B, prev1, 'staging')).toThrow(/never cross environments/);
  });

  it('refuses a retained file whose bytes do not match the recorded hash', () => {
    const tampered = { state: first.state, files: [f(OLD_JS.path, 'evil'), FONT] };
    expect(() => deploy(site2, later(DAY), COMMIT_B, tampered)).toThrow(/does not match its recorded sha256/);
  });

  it('refuses a listed file that is missing', () => {
    expect(() => deploy(site2, later(DAY), COMMIT_B, { state: first.state, files: [FONT] })).toThrow(/missing/);
  });

  it('refuses a hashed name that the new build produces with different bytes', () => {
    const clash = [html('BBBBBBBB'), f(OLD_JS.path, 'different'), FONT];
    expect(() => deploy(clash, later(DAY), COMMIT_B, prev1)).toThrow(/different bytes/);
  });

  it('refuses timestamps in the future and a short commit', () => {
    expect(() => deploy(site2, later(-DAY), COMMIT_B, prev1)).toThrow(/future/);
    expect(() => deploy(site2, later(DAY), 'abc', prev1)).toThrow(/40-character/);
  });

  it('is deterministic: state keys are sorted', () => {
    const r = deploy(site2, later(DAY), COMMIT_B, prev1);
    const keys = Object.keys(r.state.assets);
    expect(keys).toEqual([...keys].sort());
  });
});

describe('parseState', () => {
  const good = deploy([OLD_JS], T0, COMMIT_A, null).state;

  it('round-trips', () => {
    expect(parseState(formatState(good))).toEqual(good);
  });

  it.each([
    ['not JSON', 'nope'],
    ['a wrong version', JSON.stringify({ ...good, version: 2 })],
    ['a non-hashed path', JSON.stringify({ ...good, assets: { 'index.html': good.assets[OLD_JS.path] } })],
    ['a bad sha256', JSON.stringify({ ...good, assets: { [OLD_JS.path]: { ...good.assets[OLD_JS.path], sha256: 'x' } } })],
    ['a bad time', JSON.stringify({ ...good, assets: { [OLD_JS.path]: { ...good.assets[OLD_JS.path], lastCurrent: 'soon' } } })],
  ])('refuses %s', (_label, text) => {
    expect(() => parseState(text)).toThrow(RetentionError);
  });
});

describe('retention CLI', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function tree(root: string, files: FileBytes[]): void {
    for (const x of files) {
      mkdirSync(dirname(join(root, x.path)), { recursive: true });
      writeFileSync(join(root, x.path), x.bytes);
    }
  }
  function cli(args: string[]): { status: number | null; output: string } {
    const r = spawnSync(process.execPath, [join(REPO_ROOT, 'tools/gates/src/deploy/retention-cli.ts'), 'merge', ...args], { encoding: 'utf8' });
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  }

  it('merges two deploys end to end and writes the state for the next one', () => {
    const base = mkdtempSync(join(tmpdir(), 'run-retention-'));
    dirs.push(base);
    tree(join(base, 'site1'), [f('index.html', 'v1'), OLD_JS]);
    const common = ['--env', 'production', '--site'];
    expect(cli([...common, join(base, 'site1'), '--commit', COMMIT_A, '--now', T0.toISOString(), '--no-previous', '--out', join(base, 'out1'), '--state-out', join(base, 'state1')]).status).toBe(0);
    tree(join(base, 'site2'), [f('index.html', 'v2'), NEW_JS]);
    const r = cli([...common, join(base, 'site2'), '--commit', COMMIT_B, '--now', later(DAY).toISOString(), '--previous', join(base, 'state1'), '--out', join(base, 'out2'), '--state-out', join(base, 'state2')]);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain('1 current, 1 retained, 0 expired');
    expect(readFileSync(join(base, 'out2/index.html'), 'utf8')).toBe('v2');
    expect(readFileSync(join(base, 'out2', OLD_JS.path), 'utf8')).toBe('old');
    expect(readFileSync(join(base, 'state2', NEW_JS.path), 'utf8')).toBe('new');
    expect(existsSync(join(base, 'state2/index.html'))).toBe(false);
    expect(Object.keys(parseState(readFileSync(join(base, 'state2/retention.json'), 'utf8')).assets)).toEqual([OLD_JS.path, NEW_JS.path]);
  });

  it('refuses a tampered previous state with exit 1 and writes nothing', () => {
    const base = mkdtempSync(join(tmpdir(), 'run-retention-'));
    dirs.push(base);
    tree(join(base, 'site1'), [f('index.html', 'v1'), OLD_JS]);
    cli(['--env', 'production', '--site', join(base, 'site1'), '--commit', COMMIT_A, '--now', T0.toISOString(), '--no-previous', '--out', join(base, 'out1'), '--state-out', join(base, 'state1')]);
    writeFileSync(join(base, 'state1', OLD_JS.path), 'evil');
    tree(join(base, 'site2'), [f('index.html', 'v2'), NEW_JS]);
    const r = cli(['--env', 'production', '--site', join(base, 'site2'), '--commit', COMMIT_B, '--now', later(DAY).toISOString(), '--previous', join(base, 'state1'), '--out', join(base, 'out2'), '--state-out', join(base, 'state2')]);
    expect(r.status).toBe(1);
    expect(existsSync(join(base, 'out2'))).toBe(false);
  });

  it('needs exactly one of --previous and --no-previous', () => {
    const base = mkdtempSync(join(tmpdir(), 'run-retention-'));
    dirs.push(base);
    tree(join(base, 'site'), [f('index.html', 'v')]);
    const args = ['--env', 'production', '--site', join(base, 'site'), '--commit', COMMIT_A, '--now', T0.toISOString(), '--out', join(base, 'o'), '--state-out', join(base, 's')];
    expect(cli(args).status).toBe(2);
    expect(cli([...args, '--no-previous', '--previous', base]).status).toBe(2);
  });
});

describe('selecting the previous deployment', () => {
  const REPO = 42;
  const artifact = (over: Record<string, unknown> = {}, run: Record<string, unknown> = {}) => ({
    id: 1,
    name: 'run-deployed-production',
    expired: false,
    created_at: '2026-11-01T00:00:00Z',
    workflow_run: { id: 100, repository_id: REPO, head_repository_id: REPO, head_branch: 'main', ...run },
    ...over,
  });

  it('picks the newest qualifying artifact', () => {
    const list = { artifacts: [artifact(), artifact({ id: 2, created_at: '2026-11-02T00:00:00Z' }, { id: 200 })] };
    expect(selectPreviousRun(list, 'run-deployed-production', REPO)).toBe(200);
  });

  it.each([
    ['another name', artifact({ name: 'run-deployed-staging' })],
    ['an expired artifact', artifact({ expired: true })],
    ['a fork', artifact({}, { head_repository_id: 7 })],
    ['another branch', artifact({}, { head_branch: 'feature' })],
    ['another repository', artifact({}, { repository_id: 7 })],
    ['no run', artifact({ workflow_run: undefined })],
  ])('ignores %s', (_label, a) => {
    expect(selectPreviousRun({ artifacts: [a] }, 'run-deployed-production', REPO)).toBeNull();
  });

  const run = { id: 100, event: 'push', head_branch: 'main', path: '.github/workflows/ci.yml', repository: { id: REPO }, head_repository: { id: REPO } };

  it('trusts a push run of ci.yml on main in this repository', () => {
    expect(checkPreviousRun(run, 100, REPO)).toEqual([]);
  });

  it.each([
    ['a pull request run', { event: 'pull_request' }],
    ['another workflow', { path: '.github/workflows/evil.yml' }],
    ['another branch', { head_branch: 'x' }],
    ['a fork head', { head_repository: { id: 7 } }],
    ['another run id', { id: 101 }],
  ])('refuses %s', (_label, over) => {
    expect(checkPreviousRun({ ...run, ...over }, 100, REPO)).not.toEqual([]);
  });
});
