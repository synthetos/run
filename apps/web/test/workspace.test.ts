/**
 * Stage 1 workspace units: the strip's plain words from a snapshot (unknown
 * is a dash, never zero), the settings backup (GETs one at a time, no G21,
 * file name by board id and date), the DXF/SVG fixture outline reader, the
 * storage module, and the library adapter (placeholder data, safe links).
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { one, root, text } from './tree.ts';
import { SpindleSection } from '../src/workspace/views/RunView.ts';
import { backupBlocked, backupFileName, BACKUP_CONTEXT_TOKENS, SettingsBackup } from '../src/live/backup.ts';
import { createWorkspaceModel, INITIAL_LIVE_VIEW, type LiveView } from '../src/workspace/model.ts';
import { OutlineError, parseDxfOutline, parseSvgOutline } from '../src/workspace/outline.ts';
import { coolantText, coord, displayReadouts, NOT_REPORTED, spindleText, stripStatus, UNKNOWN } from '../src/workspace/status.ts';
import { readStored, writeStored, type StorageLike } from '../src/workspace/storage.ts';
import { allMaterials, doNotMachine, safeExternalLink, SEED_SETUP, toolStore } from '../src/workspace/library.ts';
import { isPlaceholder } from '@synthetos/library';
import { fileFacts, SAMPLES } from '../src/workspace/samples.ts';

type Snapshot = NonNullable<LiveView['message']>['snapshot'];

function snap(extra: Partial<Snapshot> = {}): Snapshot {
  return {
    base: 'CONNECTED_UNKNOWN',
    overlays: ['READ_ONLY'],
    primaryOverlay: 'READ_ONLY',
    epoch: 1,
    port: null,
    probe: null,
    identity: { fb: 450.01, fv: 0.97, hp: 1, hv: 8, id: 'SIM-EN-0001' },
    classification: { dialectId: 'tinyg-en', mode: 'readOnly', reason: 'en-not-approved', detail: '', upgradeOffer: false },
    footerRev: null,
    live: { machineClass: 'idle', stat: 1, pos: {}, mpo: {} },
    values: {},
    fault: null,
    ackVerifying: false,
    blocked: null,
    notices: { adviseEstop: false },
    xoff: false,
    lastAckAt: null,
    stale: null,
    sent: { lines: 0, realtime: 0 },
    ...extra,
  } as unknown as Snapshot;
}

function view(s: Snapshot): LiveView {
  return { ...INITIAL_LIVE_VIEW, message: { v: 3, kind: 'snapshot', snapshot: s, dro: { axes: [], machineSource: { label: 'status report', at: null, ageMs: null, lag: 'none' }, workSource: { label: 'status report' }, units: 'mm', wcs: { code: null, offsets: null, total: null }, marker: null }, lag: { amberMs: 1000, redMs: 2000 }, motion: false } as LiveView['message'] };
}

describe('machine strip status', () => {
  it('not connected: no readouts', () => {
    const s = stripStatus(INITIAL_LIVE_VIEW, null);
    expect(s).toMatchObject({ connected: false, title: 'Not connected', tone: 'off', readouts: [] });
  });

  it('connected read-only: plain words, and unknown readouts are dashes, never zero', () => {
    const s = stripStatus(view(snap()), 'Workshop router');
    expect(s.title).toBe('Connected · read only');
    expect(s.pill?.text).toBe('Read only');
    expect(s.name).toContain('Workshop router');
    expect(s.name).toContain('TinyG v8');
    expect(s.name).toContain('450.01');
    for (const r of s.readouts) expect(r.value).toBe(UNKNOWN);
    const withFeed = stripStatus(view(snap({ live: { machineClass: 'running', vel: 1112, feed: 1500, line: 135, pos: {}, mpo: {} } } as Partial<Snapshot>)), null);
    expect(withFeed.title).toBe('Moving');
    expect(withFeed.readouts[0]?.value).toBe('1 112 / 1 500');
    expect(withFeed.readouts.find((r) => r.label === 'Spindle')?.value).toBe(UNKNOWN);
    expect(withFeed.readouts.find((r) => r.label === 'Coolant')?.value).toBe(UNKNOWN);
    expect(withFeed.readouts.find((r) => r.label === 'Job')?.value).toBe('line 135');
  });

  it('spindle and coolant readouts: shown only when the board reports them, in plain words', () => {
    const live = (extra: Record<string, unknown>) => ({ pos: {}, mpo: {}, ...extra }) as Snapshot['live'];
    const strip = (extra: Record<string, unknown>) => stripStatus(view(snap({ live: live(extra) } as Partial<Snapshot>)), null);
    const value = (s: ReturnType<typeof stripStatus>, label: string) => s.readouts.find((r) => r.label === label)?.value;
    const on = strip({ srList: ['stat', 'spe', 'spc', 'spd', 'sps', 'cof', 'com'], spe: 1, spc: 1, spd: 0, sps: 18000, cof: 1, com: 0 });
    expect(value(on, 'Spindle')).toBe('On · CW · 18 000 rpm commanded');
    expect(value(on, 'Coolant')).toBe('Flood');
    expect(on.spindleOn).toBe(true);
    expect(spindleText(live({ spe: 1, spc: 2, sps: 7000 }))).toBe('On · CCW · 7 000 rpm commanded');
    expect(spindleText(live({ spe: 0, spc: 0, spd: 1, sps: 0 }))).toBe('Off');
    expect(coolantText(live({ cof: 0, com: 0 }))).toBe('Off');
    expect(coolantText(live({ cof: 1, com: 1 }))).toBe('Flood and mist');
    expect(coolantText(live({ cof: 0, com: 1 }))).toBe('Mist');
    // Not in the board's status list (its answer to {sr:null}): said so. Status list not seen yet: the dash.
    const absent = strip({ srList: ['line', 'posx', 'stat'] });
    expect(value(absent, 'Spindle')).toBe(NOT_REPORTED);
    expect(value(absent, 'Coolant')).toBe(NOT_REPORTED);
    expect(NOT_REPORTED).toBe('Not reported by this board’s status list');
    expect(absent.spindleOn).toBe(false);
    expect(value(strip({}), 'Spindle')).toBe(UNKNOWN);
    expect(value(strip({}), 'Coolant')).toBe(UNKNOWN);
  });

  it('polled readouts (the worker’s read-only GETs) fill in what the status list lacks; the status report wins; failed answers are ignored', () => {
    const polled = (v: unknown, status = 0) => ({ value: v, status, at: 1 });
    const s = snap({ live: { pos: {}, mpo: {}, srList: ['stat', 'line'], cof: 0 }, values: { spe: polled(1), spc: polled(2), sps: polled(9000), cof: polled(1), com: polled(1, 100) } } as unknown as Partial<Snapshot>);
    const r = displayReadouts(s);
    expect(r).toMatchObject({ spe: 1, spc: 2, sps: 9000, cof: 0 });
    expect(r?.com).toBeUndefined();
    expect(spindleText(r)).toBe('On · CCW · 9 000 rpm commanded');
    expect(coolantText(r)).toBe('Flood off');
    const strip = stripStatus(view(s), null);
    expect(strip.readouts.find((x) => x.label === 'Spindle')?.value).toBe('On · CCW · 9 000 rpm commanded');
    expect(strip.spindleOn).toBe(true);
    // No status-list field and no poll answer yet: still "not reported".
    const none = snap({ live: { pos: {}, mpo: {}, srList: ['stat'] } } as unknown as Partial<Snapshot>);
    expect(spindleText(displayReadouts(none))).toBe(NOT_REPORTED);
    expect(displayReadouts(null)).toBeUndefined();
  });

  it('the Run spindle card shows the reported readouts, "Off", "not reported", or the dash', () => {
    const card = (liveExtra: Record<string, unknown> | null) => {
      const model = createWorkspaceModel();
      if (liveExtra !== null) model.live.value = view(snap({ live: { pos: {}, mpo: {}, ...liveExtra } } as Partial<Snapshot>));
      const el = root(h(SpindleSection, { model }));
      return { spindle: text(one(el, (e) => e.props['data-spindle'] === 'spindle')), coolant: text(one(el, (e) => e.props['data-spindle'] === 'coolant')), el };
    };
    const on = card({ spe: 1, spc: 1, spd: 0, sps: 18000, cof: 0, com: 1 });
    expect(on.spindle).toBe('Spindle on · CW · 18 000 rpm commanded');
    expect(on.coolant).toBe('Coolant: Mist');
    expect(card({ spe: 0, spc: 0, sps: 0, cof: 0, com: 0 })).toMatchObject({ spindle: 'Off', coolant: 'Coolant: off' });
    expect(card({ srList: ['stat'] })).toMatchObject({ spindle: NOT_REPORTED, coolant: `Coolant: ${NOT_REPORTED}` });
    expect(card(null)).toMatchObject({ spindle: UNKNOWN, coolant: `Coolant: ${UNKNOWN}` });
    // Display only: every spindle and coolant control stays disabled whatever the board reports.
    const buttons = (function walk(e: typeof on.el): (typeof on.el)[] {
      return [...(e.tag === 'button' ? [e] : []), ...e.children.flatMap((c) => (typeof c === 'string' ? [] : walk(c)))];
    })(on.el);
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.props['disabled']).toBe(true);
  });

  it('lost, orphaned and needs-review are said plainly', () => {
    expect(stripStatus(view(snap({ overlays: ['LOST', 'READ_ONLY'] })), null).title).toBe('Connection lost');
    expect(stripStatus(view(snap({ overlays: ['ORPHANED_MOTION'] })), null).tone).toBe('alarm');
    const orphaned = stripStatus(view(snap({ overlays: ['ORPHANED_MOTION'] })), null);
    expect(orphaned.title).toBe("Moves this page didn't send");
    // What to do comes first, in plain words: look, E-stop if it moves, how to clear it.
    expect(orphaned.text).toMatch(/^Look at the machine: if it moves, use your E-stop\./);
    expect(orphaned.text).toContain('reset or power-cycle the controller, then reload this page and connect again');
    expect(stripStatus(view(snap({ overlays: ['READ_ONLY', 'NEEDS_REVIEW'] })), null).pill?.text).toBe('Needs review');
  });

  it('coordinates use three decimals and a true minus; unknown is a dash', () => {
    expect(coord(-2)).toBe('−2.000');
    expect(coord(null)).toBe(UNKNOWN);
  });
});

describe('settings backup', () => {
  it('is named by board id and date, with unsafe characters removed', () => {
    expect(backupFileName('SIM-EN-0001', new Date('2026-11-02T10:00:00Z'))).toBe('synthetos-settings-SIM-EN-0001-2026-11-02.json');
    expect(backupFileName('../a b', new Date('2026-11-02T10:00:00Z'))).toBe('synthetos-settings-a-b-2026-11-02.json');
    expect(backupFileName(null, new Date('2026-11-02T10:00:00Z'))).toBe('synthetos-settings-no-board-id-2026-11-02.json');
  });

  it('is blocked until a classified board is connected', () => {
    expect(backupBlocked(null)).toMatch(/Connect/);
    expect(backupBlocked(snap({ base: 'READING' }))).toMatch(/identified/);
    expect(backupBlocked(snap())).toBeNull();
  });

  it('asks for one token at a time, each after the previous answer, never G21, and records the units', async () => {
    const backup = new SettingsBackup();
    let values: Record<string, { value: unknown; status: number; at: number }> = {};
    let at = 1;
    backup.onSnapshot(snap());
    const asked: string[][] = [];
    let outstanding = 0;
    const file = await backup.run({
      read: async (tokens) => {
        expect(outstanding).toBe(0);
        outstanding += 1;
        asked.push([...tokens]);
        const token = tokens[0] as string;
        queueMicrotask(() => {
          values = { ...values, [token]: { value: token === 'unit' ? 1 : token === 'coor' ? 1 : { vm: 1000 }, status: token === 'z' ? 100 : 0, at: at++ } };
          outstanding -= 1;
          backup.onSnapshot(snap({ values } as Partial<Snapshot>));
        });
        return { ok: true };
      },
      now: () => new Date('2026-11-02T10:00:00Z'),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onProgress: () => undefined,
    });
    expect(asked.every((t) => t.length === 1)).toBe(true);
    expect(asked.slice(0, 2).map((t) => t[0])).toEqual([...BACKUP_CONTEXT_TOKENS]);
    expect(asked.flat()).not.toContain('G21');
    expect(file.units).toMatchObject({ unit: 1, label: 'mm', g21Sent: false });
    expect(file.board.id).toBe('SIM-EN-0001');
    expect(file.unanswered.find((u) => u.token === 'z')?.reason).toMatch(/status 100/);
  });
});

describe('fixture outlines', () => {
  it('SVG: the largest closed shape is the outline, circles are holes, Y is flipped to up', () => {
    const svg = '<svg><rect x="0" y="0" width="300" height="200"/><circle cx="25" cy="25" r="3"/><polygon points="10,10 20,10 20,20"/><script>alert(1)</script></svg>';
    const o = parseSvgOutline(svg);
    expect(o.width).toBe(300);
    expect(o.depth).toBe(200);
    expect(o.holes).toEqual([[25, 175, 3]]);
  });

  it('DXF: LWPOLYLINE and CIRCLE from ENTITIES', () => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '10', '0', '20', '0', '10', '100', '20', '0', '10', '100', '20', '50', '10', '0', '20', '50', '0', 'CIRCLE', '10', '10', '20', '10', '40', '2', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const o = parseDxfOutline(dxf);
    expect([o.width, o.depth]).toEqual([100, 50]);
    expect(o.holes).toEqual([[10, 10, 2]]);
  });

  it('refuses a file with no outline', () => {
    expect(() => parseSvgOutline('<svg><text>hi</text></svg>')).toThrow(OutlineError);
  });
});

describe('storage and library adapter', () => {
  it('reads back what it wrote, and refuses another version or an invalid value', () => {
    const map = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
    const isNum = (v: unknown): v is number => typeof v === 'number';
    expect(writeStored('x', 4, storage)).toBe(true);
    expect(readStored('x', isNum, storage)).toBe(4);
    map.set('run.ws.x', JSON.stringify({ v: 99, value: 4 }));
    expect(readStored('x', isNum, storage)).toBeNull();
    const throwing: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readStored('x', isNum, throwing)).toBeNull();
    expect(writeStored('x', 1, throwing)).toBe(false);
  });

  it('materials are the library built-ins, with placeholder flags and a do-not-machine entry', () => {
    const list = allMaterials.value;
    expect(list.length).toBeGreaterThan(5);
    expect(list.some((m) => doNotMachine(m.material))).toBe(true);
    const al = list[0]?.material;
    expect(al !== undefined && al.cutting[0] !== undefined && isPlaceholder(al.cutting[0].vc)).toBe(true);
  });

  it('seed tools and setup are valid library records; links are http(s) only', () => {
    expect(toolStore.value.value.length).toBe(6);
    expect(SEED_SETUP.stock.materialRef.id).toBe('builtin.al-6061');
    expect(safeExternalLink('javascript:alert(1)')).toBeNull();
    expect(safeExternalLink('https://example.com/x')?.rel).toBe('noopener noreferrer nofollow');
  });

  it('the sample files are ASCII, and the job card finds their tool changes and operations', () => {
    const plate = SAMPLES.find((s) => s.id === 'mounting-plate');
    const text = plate?.text() ?? '';
    expect([...text].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    const facts = fileFacts(new TextEncoder().encode(text));
    expect(facts.toolChanges.map((t) => t.tool)).toEqual([5, 1]);
    expect(facts.operations.map((o) => o.name)).toEqual(['Drill mounting holes', 'Clear the centre pocket', 'Cut out with tabs']);
  });
});
