/**
 * ROADMAP P1-07, window side: the connect-time settings read and drift
 * check (LiveReadout), the DRO panel, the settings view and the preview's
 * live marker.
 */
import { describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { settingsReadGroups } from '@synthetos/schema';
import { DRO_TOKENS, LiveReadout, referenceKey, type ReadoutDeps } from '../src/live/readout.ts';
import { memoryDeviceSafety } from '../src/live/deviceSafety.ts';
import { Dro, formatAge, formatAxis, lagAt } from '../src/machine-ui/Dro.ts';
import { SettingsView, valueText } from '../src/machine-ui/SettingsView.ts';
import { PreviewSvg, markerRadius } from '../src/preview/PreviewSvg.ts';
import { markerText } from '../src/preview/PreviewPanel.ts';
import type { SnapshotMessage, WorkerStatus } from '../src/machine-worker/rpc.ts';
import { all, one, root, text } from './tree.ts';

type Snapshot = WorkerStatus['session'];

const GROUPS = settingsReadGroups('tinyg-en');

/** A snapshot of a connected, classified edge-next board with `values`. */
function snap(values: Record<string, { value: unknown; status: number; at: number }>, over: Partial<Record<string, unknown>> = {}): Snapshot {
  return {
    base: 'CONNECTED_UNKNOWN',
    overlays: ['READ_ONLY'],
    epoch: 1,
    classification: { dialectId: 'tinyg-en', mode: 'readOnly', reason: 'notApproved', detail: '', upgradeOffer: false },
    identity: { id: 'SIM-EN-0001', fb: 450.01 },
    values,
    live: { pos: {}, mpo: {} },
    ...over,
  } as unknown as Snapshot;
}

/** Every settings group answered, each member 1 except `xvm`. */
function allGroups(xvm = 16000, status = 0): Record<string, { value: unknown; status: number; at: number }> {
  const out: Record<string, { value: unknown; status: number; at: number }> = {};
  for (const g of GROUPS) {
    const value: Record<string, unknown> = {};
    for (const m of g.members) value[g.token !== 'sys' && m.startsWith(g.token) ? m.slice(g.token.length) : m] = m === 'xvm' ? xvm : 1;
    out[g.token] = { value, status, at: 5 };
  }
  return out;
}

function deps(over: Partial<ReadoutDeps> = {}): ReadoutDeps & { reads: string[][]; drifts: number[]; changes: number } {
  const d = {
    reads: [] as string[][],
    drifts: [] as number[],
    changes: 0,
    read: (tokens: readonly string[]) => {
      d.reads.push([...tokens]);
      return Promise.resolve({ ok: true });
    },
    drift: (epoch: number) => {
      d.drifts.push(epoch);
      return Promise.resolve();
    },
    store: memoryDeviceSafety(),
    now: () => new Date('2026-11-01T12:00:00Z'),
    onChange: () => {
      d.changes++;
    },
    ...over,
  };
  return d;
}

const settled = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** Waits until the readout leaves `reading` (the hash is computed by WebCrypto, off the microtask queue). */
const done = (r: LiveReadout): Promise<void> => vi.waitFor(() => expect(r.phase.kind).not.toBe('reading'));

describe('LiveReadout: the connect-time read and the drift check', () => {
  it('reads the DRO tokens and every allowlisted group once per link, through the worker read only', async () => {
    const d = deps();
    const r = new LiveReadout(d);
    r.onSnapshot(snap({}, { base: 'READING' }));
    expect(d.reads).toEqual([]);
    r.onSnapshot(snap({}));
    r.onSnapshot(snap({}));
    expect(d.reads).toEqual([[...DRO_TOKENS, ...GROUPS.map((g) => g.token)]]);
    expect(d.reads[0]?.length).toBeLessThanOrEqual(32);
    expect(r.phase).toEqual({ kind: 'reading' });
    expect(r.dialectId).toBe('tinyg-en');
  });

  it('records the first complete read as the reference, then matches it on the next link', async () => {
    const d = deps();
    const r = new LiveReadout(d);
    r.onSnapshot(snap({}));
    r.onSnapshot(snap(allGroups()));
    await done(r);
    expect(r.phase.kind).toBe('recorded');
    expect(r.settings['xvm']).toBe(16000);
    const stored = (await d.store.get(referenceKey('tinyg-en', 'SIM-EN-0001'))) as { deviceHash: string; at: string };
    expect(stored.deviceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.at).toBe('2026-11-01T12:00:00.000Z');

    r.onSnapshot(snap({}, { epoch: 2 }));
    r.onSnapshot(snap(allGroups(), { epoch: 2 }));
    await done(r);
    expect(r.phase.kind).toBe('match');
    expect(d.drifts).toEqual([]);
  });

  it('a changed setting is drift: the worker is told (NEEDS_REVIEW) and the diff is shown; Keep writes only the reference', async () => {
    const d = deps();
    const r = new LiveReadout(d);
    r.onSnapshot(snap({}));
    r.onSnapshot(snap(allGroups(16000)));
    await done(r);
    r.onSnapshot(snap({}, { epoch: 3 }));
    r.onSnapshot(snap(allGroups(9000), { epoch: 3 }));
    await done(r);
    expect(d.drifts).toEqual([3]);
    const phase = r.phase;
    expect(phase.kind).toBe('drift');
    if (phase.kind !== 'drift') throw new Error('unreachable');
    expect(phase.result.diffs).toEqual([{ key: 'xvm', expected: 16000, board: 9000, source: 'previous' }]);
    // The read sent nothing but the DRO and group GETs.
    for (const tokens of d.reads) for (const t of tokens) expect([...DRO_TOKENS, ...GROUPS.map((g) => g.token)]).toContain(t);

    await r.keepBoardSettings();
    expect(r.phase).toMatchObject({ kind: 'drift', accepted: true });
    expect(((await d.store.get(referenceKey('tinyg-en', 'SIM-EN-0001'))) as { deviceHash: string }).deviceHash).toBe(phase.hash);
    await r.keepBoardSettings(); // already accepted: nothing more
  });

  it('an errored group makes the read incomplete (no hash, no drift); a refused read says why', async () => {
    const d = deps();
    const r = new LiveReadout(d);
    r.onSnapshot(snap({}));
    const values = allGroups();
    values['x'] = { value: null, status: -1, at: 5 };
    r.onSnapshot(snap(values));
    await settled();
    expect(r.phase).toMatchObject({ kind: 'incomplete' });
    expect(d.drifts).toEqual([]);

    const refused = deps({ read: () => Promise.resolve({ ok: false, message: 'Not on the tinyg-en read allowlist' }) });
    const r2 = new LiveReadout(refused);
    r2.onSnapshot(snap({}));
    await settled();
    expect(r2.phase).toEqual({ kind: 'incomplete', message: 'Not on the tinyg-en read allowlist' });

    const thrown = deps({ read: () => Promise.reject(new Error('worker gone')) });
    const r3 = new LiveReadout(thrown);
    r3.onSnapshot(snap({}));
    await settled();
    expect(r3.phase).toEqual({ kind: 'incomplete', message: 'worker gone' });
  });

  it('a board without an id is hashed but not compared; disconnect returns to idle', async () => {
    const d = deps();
    const r = new LiveReadout(d);
    r.onSnapshot(snap({}, { identity: { fb: 450.01 } }));
    r.onSnapshot(snap(allGroups(), { identity: { fb: 450.01 } }));
    await done(r);
    expect(r.phase.kind).toBe('noBoardId');
    await r.keepBoardSettings();
    expect(r.phase.kind).toBe('noBoardId');
    r.onSnapshot(snap({}, { base: 'NOT_CONNECTED' }));
    expect(r.phase).toEqual({ kind: 'idle' });
  });

  it('never reads an unclassified, LOST or g2core link', () => {
    const d = deps();
    const r = new LiveReadout(d);
    r.onSnapshot(snap({}, { classification: null }));
    r.onSnapshot(snap({}, { overlays: ['LOST'] }));
    r.onSnapshot(snap({}, { classification: { dialectId: 'g2core', mode: 'readOnly' } }));
    expect(d.reads).toEqual([]);
    expect(r.phase).toEqual({ kind: 'idle' });
  });
});

function message(over: Partial<SnapshotMessage['dro']> = {}, snapOver: Record<string, unknown> = {}): SnapshotMessage {
  return {
    v: 3,
    kind: 'snapshot',
    snapshot: { overlays: [], identity: { id: 'SIM-EN-0001', fbs: 'abc123' }, ...snapOver } as unknown as Snapshot,
    lag: { amberMs: 1000, redMs: 2000 },
    dro: {
      axes: [
        { axis: 'x', machine: 110, work: 10, homed: true },
        { axis: 'y', machine: 52, work: 2, homed: false },
        { axis: 'z', machine: null, work: null, homed: null },
        { axis: 'a', machine: null, work: null, homed: null },
      ],
      machineSource: { label: 'polled mpo', at: 1000, ageMs: 200, lag: 'fresh' },
      workSource: { label: 'status report' },
      units: 'mm',
      wcs: { code: 'G54', offsets: { x: 100, y: 50 }, total: { x: 100, y: 50, z: 0 } },
      marker: { x: 10, y: 2, z: 0, ageMs: 200, lag: 'fresh' },
      ...over,
    },
  };
}

describe('Dro panel', () => {
  it('shows work and machine coordinates, WCS, homed flags, with source, age and lag', () => {
    const el = root(h(Dro, { message: message(), elapsedMs: 100 }));
    const rows = all(el, (e) => e.tag === 'tr' && e.props['data-axis'] !== undefined);
    expect(rows.map((r) => r.props['data-axis'])).toEqual(['x', 'y', 'z']);
    expect(text(one(rows[0] as never, (e) => e.props['data-dro'] === 'machine'))).toBe('110.000');
    expect(text(one(rows[0] as never, (e) => e.props['data-dro'] === 'work'))).toBe('10.000');
    expect(text(one(rows[1] as never, (e) => e.props['data-dro'] === 'homed'))).toBe('no');
    expect(text(one(rows[2] as never, (e) => e.props['data-dro'] === 'homed'))).toBe('not read');
    expect(text(one(el, (e) => e.props['data-dro'] === 'age'))).toBe('0.3 s ago');
    expect(one(el, (e) => e.props['data-lag'] !== undefined).props['data-lag']).toBe('fresh');
    expect(text(one(el, (e) => e.props['data-dro'] === 'wcs'))).toContain('G54 (offsets X 100.000, Y 50.000 mm)');
    expect(text(el)).toContain('polled mpo');
    expect(text(el)).toContain('last status report');
  });

  it('ages the badge in the window: amber from 1 s, red from 2 s or at STALE', () => {
    const lagOf = (elapsedMs: number, overlays: string[] = []): unknown =>
      one(root(h(Dro, { message: message({}, { overlays }), elapsedMs })), (e) => e.props['data-lag'] !== undefined).props['data-lag'];
    expect(lagOf(799)).toBe('fresh');
    expect(lagOf(800)).toBe('amber');
    expect(lagOf(1800)).toBe('red');
    expect(lagOf(0, ['STALE'])).toBe('red');
    const none = root(h(Dro, { message: message({ machineSource: { label: 'polled mpo', at: null, ageMs: null, lag: 'none' } }), elapsedMs: 5000 }));
    expect(one(none, (e) => e.props['data-lag'] !== undefined).props['data-lag']).toBe('none');
    expect(lagAt(null, true, { amberMs: 1, redMs: 2 })).toBe('none');
  });

  it('T-S85: a hostile board id renders as text with its bidi and control characters replaced', () => {
    const id = `${String.fromCharCode(0x202e)}EVIL<script>${String.fromCharCode(0x0a)}x`;
    const el = root(h(Dro, { message: message({}, { identity: { id, fbs: 'b' } }), elapsedMs: 0 }));
    const shown = text(one(el, (e) => e.props['data-board-text'] === 'id'));
    expect(shown).toBe('�EVIL<script>�x');
    // Rendered as a text child, never as markup.
    expect(all(el, (e) => e.tag === 'script')).toEqual([]);
    expect(all(el, (e) => Object.keys(e.props).some((k) => k.startsWith('dangerously')))).toEqual([]);
    const noId = root(h(Dro, { message: message({}, { identity: null }), elapsedMs: 0 }));
    expect(text(one(noId, (e) => e.props['data-dro'] === 'identity'))).toBe('Board without an id');
  });

  it('formats', () => {
    expect(formatAxis(null)).toBe('-');
    expect(formatAxis(-1.23456)).toBe('-1.235');
    expect(formatAge(null)).toBe('never');
    const noWcs = root(h(Dro, { message: message({ units: null, wcs: { code: null, offsets: null, total: null } }), elapsedMs: 0 }));
    expect(text(one(noWcs, (e) => e.props['data-dro'] === 'wcs'))).toBe('Work coordinate system: not read');
    expect(text(noWcs)).toContain('Work (units unknown)');
    const g53 = root(h(Dro, { message: message({ wcs: { code: 'G53', offsets: null, total: { a: 1 } } }), elapsedMs: 0 }));
    expect(text(one(g53, (e) => e.props['data-dro'] === 'wcs'))).toBe('Work coordinate system: G53. Total offset including G92: none.');
  });

  it('under G20 (unit 0) the G54 offsets are labelled in inches and the ofs total in millimetres', () => {
    // g54x.. are F_CONVERT (printed in the current units); ofs is always mm (EN config_app.c:846-849).
    const el = root(h(Dro, { message: message({ units: 'in', wcs: { code: 'G54', offsets: { x: 1 }, total: { x: 25.4 } } }), elapsedMs: 0 }));
    expect(text(one(el, (e) => e.props['data-dro'] === 'wcs'))).toBe('Work coordinate system: G54 (offsets X 1.000 in). Total offset including G92: X 25.400 mm.');
    const unread = root(h(Dro, { message: message({ units: null, wcs: { code: 'G54', offsets: { x: 1 }, total: null } }), elapsedMs: 0 }));
    expect(text(one(unread, (e) => e.props['data-dro'] === 'wcs'))).toBe('Work coordinate system: G54 (offsets X 1.000, units not read)');
  });
});

describe('SettingsView', () => {
  const settings = { xvm: 16000, xtm: 300, id: `a${String.fromCharCode(0x202e)}b`, spep: 1 };

  it('groups the allowlisted settings, each group explained, keys labelled from the overlay', () => {
    const el = root(h(SettingsView, { dialectId: 'tinyg-en', phase: { kind: 'match', hash: 'f'.repeat(64), reference: { deviceHash: 'f'.repeat(64), settings: {}, at: '2026-10-01' } }, settings, onKeep: () => undefined }));
    const groups = all(el, (e) => e.tag === 'details');
    expect(groups.map((g) => g.props['data-group'])).toEqual(GROUPS.map((g) => g.token));
    const x = one(el, (e) => e.props['data-group'] === 'x');
    expect(text(x)).toContain(GROUPS.find((g) => g.token === 'x')?.explanation ?? 'missing');
    expect(text(one(x, (e) => e.props['data-key'] === 'xvm'))).toContain('16000');
    // EN overlay keys carry a label and description; board strings are sanitised.
    expect(text(one(el, (e) => e.props['data-key'] === 'id'))).toContain('a�b');
    expect(text(one(el, (e) => e.props['data-settings'] === 'match'))).toContain('2026-10-01');
    // There is no button that writes to the board.
    expect(all(el, (e) => e.tag === 'button')).toEqual([]);
  });

  it('drift shows the key-level diff and only the Keep action, which writes nothing to the machine', () => {
    let kept = 0;
    const phase = {
      kind: 'drift' as const,
      hash: 'a'.repeat(64),
      reference: { deviceHash: 'b'.repeat(64), settings: {}, at: '2026-10-01' },
      result: { drift: true, reasons: ['hash' as const, 'previous' as const], diffs: [{ key: 'xvm', expected: 12000, board: 16000, source: 'previous' as const }] },
      accepted: false,
    };
    const el = root(h(SettingsView, { dialectId: 'tinyg-en', phase, settings, onKeep: () => kept++ }));
    const banner = one(el, (e) => e.props['data-settings'] === 'drift');
    expect(banner.props['role']).toBe('alert');
    expect(text(one(banner, (e) => e.props['data-key'] === 'xvm'))).toBe('xvm1200016000');
    const buttons = all(el, (e) => e.tag === 'button');
    expect(buttons.map((b) => b.props['data-action'])).toEqual(['keep-board-settings']);
    expect(text(buttons[0] as never)).toContain('writes nothing to the machine');
    (buttons[0]?.props['onClick'] as () => void)();
    expect(kept).toBe(1);
    const done = root(h(SettingsView, { dialectId: 'tinyg-en', phase: { ...phase, accepted: true }, settings, onKeep: () => undefined }));
    expect(all(done, (e) => e.tag === 'button')).toEqual([]);
    expect(text(done)).toContain('Nothing was written to the machine');
  });

  it('says what it is doing in every other phase', () => {
    const say = (phase: Parameters<typeof SettingsView>[0]['phase'], dialectId: string | null = 'tinyg-en'): string => text(root(h(SettingsView, { dialectId, phase, settings: {}, onKeep: () => undefined })));
    expect(say({ kind: 'idle' }, null)).toContain('Connect a board');
    expect(say({ kind: 'reading' })).toContain('read allowlist');
    expect(say({ kind: 'incomplete', message: 'x did not answer' })).toContain('x did not answer');
    expect(say({ kind: 'noBoardId', hash: '0123456789abcdef' })).toContain('0123456789ab');
    expect(say({ kind: 'recorded', hash: '0123456789abcdef' })).toContain('First read');
    expect(valueText(undefined)).toBe('-');
    expect(valueText(null)).toBe('-');
    expect(valueText(1.5)).toBe('1.5');
  });
});

describe('the preview marker', () => {
  it('draws the polled position on the 2D view (Y flipped) and reads it out with its age', () => {
    const segments = { vertices: new Float32Array([0, 0, 0, 10, 10, 0]), kinds: new Uint8Array([0, 1]), lineToVertex: new Uint32Array([0, 1, 2]) };
    const el = root(h(PreviewSvg, { segments: segments as never, showRapids: true, highlight: -1, envelope: null, marker: { x: 4, y: 3, lag: 'amber' } }));
    const m = one(el, (e) => e.props['data-preview'] === 'marker');
    expect(m.props['cx']).toBe(4);
    expect(m.props['cy']).toBe(-3);
    expect(m.props['class']).toContain('lag-amber');
    expect(all(root(h(PreviewSvg, { segments: segments as never, showRapids: true, highlight: -1, envelope: null })), (e) => e.props['data-preview'] === 'marker')).toEqual([]);
    expect(markerRadius('0 0 100 50')).toBe(1.5);
    expect(markerRadius(null)).toBe(0.015);
    expect(markerText({ x: 1, y: 2, z: 3, ageMs: 1500, lag: 'amber' })).toBe('Live position (polled mpo minus offsets, 1.5 s old): X 1.000 Y 2.000 Z 3.000 mm');
  });
});
