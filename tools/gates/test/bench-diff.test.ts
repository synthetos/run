/**
 * P1-00: the bench artifact may differ from the release artifact only in the
 * build-channel chunk (src/artifact/bench.ts). Each rule fires on a synthetic
 * pair of trees; the real builds are compared in bench-acceptance.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CHANNEL_CHUNK, compareBenchArtifacts, renderBenchHashList } from '../src/artifact/bench.ts';
import type { TreeFile } from '../src/shared/files.ts';
import { BENCH_MARKER, TESTKIT_MARKER } from '../src/bundle/scan.ts';

const enc = new TextEncoder();
const file = (path: string, text: string): TreeFile => ({ path, bytes: enc.encode(text) });

function tree(opts: { channelHash: string; workspaceHash: string; channel: string; extra?: TreeFile[]; worker?: string }): TreeFile[] {
  return [
    file('index.html', `<script type="module" src="/assets/workspace-${opts.workspaceHash}.js"></script>`),
    file(`assets/workspace-${opts.workspaceHash}.js`, `import{t}from"./build-channel-${opts.channelHash}.js";t(document);`),
    file(`assets/build-channel-${opts.channelHash}.js`, opts.channel),
    file('assets/machine.worker-WWWWWWWW.js', opts.worker ?? 'self.onmessage=()=>{};'),
    file('assets/serial/web-serial-SSSSSSSS.js', 'const s=navigator.serial;export{s};'),
    ...(opts.extra ?? []),
  ];
}

const RELEASE = tree({ channelHash: 'Rel00001', workspaceHash: 'WsR00001', channel: 'function t(){return{kind:"release"}}export{t};' });
const BENCH = tree({ channelHash: 'Ben00001', workspaceHash: 'WsB00001', channel: `function t(d){d.documentElement.dataset.buildMarker="${BENCH_MARKER}";return{kind:"bench"}}export{t};` });
const rules = (r: TreeFile[], b: TreeFile[]): string[] => compareBenchArtifacts(r, b).findings.map((f) => `${f.rule} ${f.file}`);

describe('compareBenchArtifacts', () => {
  it('passes when only the channel chunk differs, though the hashed names changed', () => {
    expect(CHANNEL_CHUNK).toBe('assets/build-channel.js');
    expect(rules(RELEASE, BENCH)).toEqual([]);
  });

  it('refuses a difference anywhere else, the worker included', () => {
    const bench = tree({ channelHash: 'Ben00001', workspaceHash: 'WsB00001', channel: BENCH[2]?.bytes ? new TextDecoder().decode(BENCH[2].bytes) : '', worker: 'self.onmessage=()=>{globalThis.x=1};' });
    expect(rules(RELEASE, bench)).toEqual(['unexpected-difference assets/machine.worker.js']);
  });

  it('refuses a different file set', () => {
    expect(rules(RELEASE, [...BENCH, file('assets/extra-XXXXXXXX.js', 'x')])).toEqual(['file-set assets/extra.js']);
    expect(rules(RELEASE, BENCH.filter((f) => !f.path.startsWith('assets/serial/')))).toEqual(['file-set assets/serial/web-serial.js']);
  });

  it('refuses a bench build that swapped nothing, or trees without the channel chunk', () => {
    expect(rules(RELEASE, RELEASE)).toContain('channel-unchanged assets/build-channel.js');
    const noChannel = (t: TreeFile[]) => t.filter((f) => !f.path.includes('build-channel'));
    expect(rules(noChannel(RELEASE), noChannel(BENCH))).toContain('channel-missing assets/build-channel.js');
  });

  it('refuses the bench marker in the release tree, an unmarked bench channel and the test kit in the bench tree', () => {
    expect(rules([...RELEASE, file('robots.txt', BENCH_MARKER)], [...BENCH, file('robots.txt', BENCH_MARKER)])).toContain('release-bench-marker robots.txt');
    const unmarked = tree({ channelHash: 'Ben00001', workspaceHash: 'WsB00001', channel: 'function t(){return{kind:"bench"}}export{t};' });
    expect(rules(RELEASE, unmarked)).toEqual(['bench-channel-unmarked assets/build-channel-Ben00001.js']);
    expect(rules([...RELEASE, file('a.txt', 'x')], [...BENCH, file('a.txt', TESTKIT_MARKER)])).toContain('bench-testkit a.txt');
  });

  it('lists every logical file with its state', () => {
    const r = compareBenchArtifacts(RELEASE, BENCH);
    expect(renderBenchHashList(r.release, r.bench)).toMatch(/^channel +\w+ +\w+ +assets\/build-channel\.js$/m);
  });
});
