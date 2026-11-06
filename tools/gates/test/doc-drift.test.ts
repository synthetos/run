/**
 * Documentation and data drift (P0 review, docs group).
 *
 * DECISIONS D4 is done: edge-next reported `fb` 450.01 (EN tinyg.h:52) at
 * ead63997 when D4 was decided and through the 2026-11-02 re-pins (97321391,
 * 6ec70652, 93a723b8); the commit tagged 450.02, a7489b79, reports 450.02 and
 * is pinned in `vendor/firmware-pins.json` since the 2026-11-06 re-pin. Nothing in this
 * repository may still say the build number is "not final" or that D4 is
 * pending. The `fbs`/`cap` tokens D4 recommended, D5 image approval and the
 * D6 published release stay open and stay distinct from the build number.
 *
 * One exception is allowed, and only while it is recorded: the bench entry
 * note inside the signed manifest. Changing a signed payload needs a new
 * signature from the release key (docs/ops/release-key.md), which no fix pass
 * holds, so the note is left as signed and the owner's next re-sign must
 * replace it. The record must exist exactly while the stale note does.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/tokens/theme.ts';

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

/** Phrases that say the D4 build number is still undecided or pending. */
const STALE_D4 = [/build number is not final/i, /not final \(D4\)/i, /\buntil D4\b/, /bumped edge-next build/i, /edge-next is released \(D4/i];

/** The signed manifest pair: its note can change only with a new signature. */
const SIGNED_MANIFEST = ['firmware/approved-builds.json', 'firmware/approved-builds.unsigned.json'];

/**
 * `SAFETY.md` is the vendored safety case: it changes only by carrying the
 * change into the synthetos.com copy first and re-copying (docs/safety/README.md).
 */
const VENDORED = ['SAFETY.md', 'docs/safety/OLD-S.md'];

/** The marker the release-key page carries while the signed bench note predates D4. */
const PENDING_RESIGN_MARKER = 'signed bench note predates D4';
const PENDING_RESIGN_PAGES = ['docs/ops/release-key.md'];

const SELF = 'tools/gates/test/doc-drift.test.ts';

function trackedTextFiles(): string[] {
  const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });
  return out
    .split('\0')
    .filter((p) => p !== '' && /\.(md|ts|tsx|js|cjs|mjs|json|jsonc|ya?ml|html|txt)$/.test(p) && p !== 'pnpm-lock.yaml')
    .filter((p) => existsSync(join(REPO_ROOT, p)));
}

function staleIn(text: string): string[] {
  return STALE_D4.filter((re) => re.test(text)).map(String);
}

function benchNotes(): string[] {
  const unsigned = JSON.parse(read('firmware/approved-builds.unsigned.json')) as {
    channels: { channel: string; builds: { note: string }[] }[];
  };
  return unsigned.channels.flatMap((c) => c.builds.map((b) => b.note));
}

describe('D4 is done: no stale build-number claim', () => {
  it('no tracked file outside the signed manifest and the vendored safety case says D4 is pending', () => {
    const offenders: string[] = [];
    for (const path of trackedTextFiles()) {
      if (path === SELF || SIGNED_MANIFEST.includes(path) || VENDORED.includes(path)) continue;
      const hits = staleIn(read(path));
      if (hits.length > 0) offenders.push(`${path}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the EN pin is 450.02 at a7489b79 and its note records D4 as done, with fbs/cap and D5 still open', () => {
    const pins = JSON.parse(read('vendor/firmware-pins.json')) as {
      pins: Record<string, { commit: string; fb: number; note: string }>;
    };
    const en = pins.pins['EN'];
    expect(en?.commit).toBe('a7489b79b2d886d872e019ff1e414f716de6638b');
    expect(en?.fb).toBe(450.02);
    const note = en?.note ?? '';
    expect(note).toMatch(/D4 (is )?done/);
    expect(note).toContain('450.02');
    expect(note).toMatch(/fbs/);
    expect(note).toMatch(/\bD5\b/);
    expect(note).toMatch(/fb alone/);
  });

  it('the tinyg-en dialect header records D4 as done and still forbids classifying by fb alone', () => {
    const header = read('packages/protocol/src/dialects/tinygEn.ts').split('*/')[0] ?? '';
    expect(header).toMatch(/D4 (is )?done/);
    expect(header).toContain('450.02');
    expect(header).toMatch(/never classified\s+\*?\s*by `fb` alone/);
  });

  it('a stale signed bench note is recorded on the release-key page, and the record goes when the note is re-signed', () => {
    const stale = benchNotes().some((n) => staleIn(n).length > 0);
    for (const page of PENDING_RESIGN_PAGES) {
      expect(read(page).includes(PENDING_RESIGN_MARKER), `${page} records the pending re-sign: ${String(stale)}`).toBe(stale);
    }
  });
});

describe('status pages', () => {
  it('the README status names P0-15 and where its owner steps are', () => {
    const status = /> \*\*Status:[\s\S]*?(?=\n\n)/.exec(read('README.md'))?.[0] ?? '';
    expect(status).toContain('P0-15');
    expect(status).toContain('docs/ops/');
    expect(status).toContain('release-key.md');
  });

  // Needs the synthetos.com clone: RUN_SITE_REPO=<path> (as tokens.test.ts).
  it.skipIf(process.env['RUN_SITE_REPO'] === undefined)(
    'an owner decision DECISIONS.md marks decided is not listed as open here',
    () => {
      const decisions = readFileSync(join(process.env['RUN_SITE_REPO'] as string, 'docs/run/DECISIONS.md'), 'utf8');
      const row = (id: string): string => decisions.split('\n').find((l) => l.startsWith(`| ${id} |`)) ?? '';
      expect(row('D4')).toMatch(/DONE/);
      expect(staleIn(JSON.stringify(JSON.parse(read('vendor/firmware-pins.json'))))).toEqual([]);
      const owner = read('docs/ops/owner-decisions.md');
      const odRow = (id: string): string => owner.split('\n').find((l) => l.startsWith(`| ${id} |`)) ?? '';
      // OD-1 is the single-maintainer review rule (D40); OD-2 the run hostname and account (D39).
      for (const [od, d] of [
        ['OD-1', 'D40'],
        ['OD-2', 'D39'],
      ] as const) {
        if (/DECIDED/.test(row(d))) {
          expect(odRow(od), od).not.toMatch(/OPEN/);
          expect(odRow(od), od).toContain(d);
          expect(owner, d).toContain(d);
        }
      }
    },
  );
});
