/**
 * The Position panel's control card (owner, 2026-11-09): while the machine controls are blocked, one card says why in
 * short sentences with the way out as buttons, and the panel draws no zero or go-to-zero action at all. A passing
 * state (identifying, no status for a moment, a job or a move) is not a block. The status line is plain text.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { createWorkspaceModel, INITIAL_LIVE_VIEW, type LiveActions, type LiveView } from '../src/workspace/model.ts';
import { buildText, controlBlock, type BlockContext } from '../src/workspace/controlBlock.ts';
import { PositionPanel } from '../src/workspace/views/RunView.ts';
import { observingElsewhere } from '../src/workspace/tabControl.ts';
import { UnknownModal } from '../src/workspace/unknownModal.ts';
import { stripStatus } from '../src/workspace/status.ts';
import { motionUi } from '../src/workspace/motion.ts';

type Snapshot = NonNullable<LiveView['message']>['snapshot'];

function snap(extra: Record<string, unknown> = {}): Snapshot {
  return {
    base: 'IDLE_UNHOMED',
    overlays: [],
    primaryOverlay: null,
    identity: { fb: 450.02, fv: 0.97, hp: 1, hv: 8, id: 'SIM-EN-0001' },
    classification: { dialectId: 'tinyg-en', mode: 'full', reason: 'en-approved', detail: '', upgradeOffer: false },
    live: { machineClass: 'programStop', stat: 3, hold: 0, vel: 0, home: 0, tool: 0, pos: {}, mpo: {} },
    values: {},
    notices: { adviseEstop: false },
    motion: null,
    job: null,
    ...extra,
  } as unknown as Snapshot;
}

const READ_ONLY = { base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'], classification: { dialectId: 'tinyg-en', mode: 'readOnly', reason: 'en-not-approved', detail: '', upgradeOffer: false } };

function view(s: Snapshot | null, opts: { readonly flag?: boolean; readonly flasher?: boolean } = {}): LiveView {
  if (s === null) return INITIAL_LIVE_VIEW;
  return {
    ...INITIAL_LIVE_VIEW,
    message: {
      v: 3,
      kind: 'snapshot',
      snapshot: s,
      dro: { axes: [{ axis: 'x', machine: 1, work: 1, homed: null }, { axis: 'y', machine: 2, work: 2, homed: null }, { axis: 'z', machine: 3, work: 3, homed: null }], machineSource: { label: 'status report', at: null, ageMs: null, lag: 'none' }, workSource: { label: 'status report' }, units: 'mm', wcs: { code: 'G54', offsets: null, total: null }, marker: null },
      lag: { amberMs: 1000, redMs: 2000 },
      motion: opts.flag ?? true,
      flasher: opts.flasher ?? true,
    } as unknown as LiveView['message'],
  };
}

const CTX: BlockContext = { observing: false, trustOffered: false };

describe('controlBlock: the reason and the way out', () => {
  it('read only: names the build and offers Update firmware; Trust only where the trusted-build flow offers it', () => {
    const s = snap(READ_ONLY);
    expect(buildText(s)).toBe('450.02, no build id');
    const b = controlBlock(view(s), CTX);
    expect(b?.kind).toBe('not-approved');
    expect(b?.title).toBe('Run can’t control this board yet.');
    expect(b?.lines).toEqual(['Its firmware build isn’t on Run’s approved list (450.02, no build id).']);
    expect(b?.actions.map((a) => a.id)).toEqual(['update']);
    expect(controlBlock(view(s), { ...CTX, trustOffered: true })?.actions.map((a) => a.id)).toEqual(['trust', 'update']);
    // No flasher on this site: no Update button, and the card says so.
    const off = controlBlock(view(s, { flasher: false }), CTX);
    expect(off?.actions).toEqual([]);
    expect(off?.lines).toContain('Firmware updates are not available on this site.');
    expect(buildText(snap({ identity: { fb: 450.02, fbs: '1a2b3c4d5e6f' } }))).toBe('450.02, build 1a2b3c4d');
  });

  it('each read-only reason says its own cause in plain words, never the generic one (card, strip and control titles)', () => {
    const ro = (classification: Record<string, unknown>, extra: Record<string, unknown> = {}) => snap({ base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'], classification: { upgradeOffer: false, detail: 'session detail', ...classification }, ...extra });
    const cases: [Snapshot, string, string, readonly string[]][] = [
      [ro({ dialectId: 'tinyg-en', mode: 'readOnly', reason: 'flowControl' }, { live: { stat: 3, ex: 2 } }), 'flowControl', 'It’s set to hardware flow control (RTS/CTS, ex = 2), which Run hasn’t verified.', ['disconnect']],
      [ro({ dialectId: 'tinyg-en', mode: 'readOnly', reason: 'flowControl' }, { live: { stat: 3 } }), 'flowControl', 'Run couldn’t read its flow control setting (ex).', ['disconnect']],
      [ro({ dialectId: 'tinyg-en', mode: 'readOnly', reason: 'en-not-approved' }), 'en-not-approved', 'Its firmware build isn’t on Run’s approved list (450.02, no build id).', ['update']],
      [ro({ dialectId: 'tinyg-440', mode: 'readOnly', reason: 'tg440-not-approved' }, { identity: { fb: 440.2 } }), 'tg440-not-approved', 'Its firmware build isn’t on Run’s approved list (440.20, no build id).', ['update']],
      [ro({ dialectId: 'tinyg-449-stock', mode: 'readOnly', reason: 'stock-449' }, { identity: { fb: 449.01 } }), 'stock-449', 'It runs stock TinyG firmware (449.01, no build id), which Run only reads.', ['update']],
      [ro({ dialectId: 'g2core-edge', mode: 'readOnly', reason: 'g2core-read-only' }), 'g2core-read-only', 'Run reads g2core boards but doesn’t control them yet.', []],
      [ro({ dialectId: null, mode: 'readOnly', reason: 'g2core-unknown-build' }, { identity: { fb: 101.5 } }), 'g2core-unknown-build', 'Run doesn’t know this g2core build (101.50, no build id).', ['disconnect']],
      [ro({ dialectId: null, mode: 'readOnly', reason: 'probeFailed' }, { identity: {} }), 'probeFailed', 'Run couldn’t read the board’s identity.', ['disconnect']],
      [ro({ dialectId: null, mode: 'readOnly', reason: 'conflict' }), 'conflict', 'Run couldn’t tell which firmware this board runs.', ['disconnect']],
    ];
    for (const [s, reason, why, actions] of cases) {
      const b = controlBlock(view(s), CTX);
      expect(b?.reason, reason).toBe(reason);
      expect(b?.title, reason).toBe('Run can’t control this board yet.');
      expect(b?.lines[0], reason).toBe(why);
      expect(b?.actions.map((a) => a.id), reason).toEqual(actions);
      expect(b?.detail, reason).toBe('session detail');
      expect(stripStatus(view(s), null).text, reason).toBe(`${why} Run reads it and moves nothing.`);
      expect(motionUi(view(s)).reason, reason).toBe(`Read only. ${why}`);
    }
    // Replies with no values: the $jv hint.
    expect(controlBlock(view(cases[7]?.[0] as Snapshot), CTX)?.lines).toContain('If its replies carry no values, set $jv to 4 on TinyG.');
    // The flow-control card says how to fix it by hand (a write of ex is forbidden today, SAFETY H61).
    expect(controlBlock(view(cases[0]?.[0] as Snapshot), CTX)?.lines[1]).toBe('Set ex to 1 (XON/XOFF) with another program, then connect again.');
  });

  it('each other block has its reason and one way out', () => {
    expect(controlBlock(view(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'] })), CTX)?.kind).toBe('unknown');
    expect(controlBlock(view(snap({ base: 'ALARM' })), CTX)?.actions.map((a) => a.id)).toEqual(['clear-alarm']);
    expect(controlBlock(view(snap({ overlays: ['NEEDS_REVIEW'] })), CTX)?.actions.map((a) => a.id)).toEqual(['review']);
    expect(controlBlock(view(snap({ base: 'BLOCKED' })), CTX)?.actions.map((a) => a.id)).toEqual(['machines']);
    expect(controlBlock(view(snap({ overlays: ['LOST'] })), CTX)?.actions.map((a) => a.id)).toEqual(['disconnect']);
    expect(controlBlock(view(snap({ overlays: ['FAULT'] })), CTX)?.kind).toBe('fault');
    expect(controlBlock(view(snap({ overlays: ['ORPHANED_MOTION'] })), CTX)?.kind).toBe('orphaned');
    expect(controlBlock(view(snap({ classification: { dialectId: null, mode: 'readOnly', reason: 'conflict', detail: '', upgradeOffer: false } })), CTX)?.kind).toBe('unidentified');
    expect(controlBlock(view(snap(), { flag: false }), CTX)?.kind).toBe('flag-off');
    expect(controlBlock(view(null), { ...CTX, observing: true })?.kind).toBe('observer');
    expect(controlBlock(view(null), CTX)).toBeNull();
  });

  it('a passing state is not a block: its controls stay, disabled', () => {
    for (const extra of [{}, { base: 'IDENTIFYING', classification: null }, { overlays: ['STALE'] }, { base: 'RUNNING' }, { base: 'JOGGING' }, { base: 'HOMING' }]) {
      expect(controlBlock(view(snap(extra)), CTX), JSON.stringify(extra)).toBeNull();
    }
  });
});

describe('the Position panel', () => {
  function model(s: Snapshot, opts: { readonly flag?: boolean; readonly flasher?: boolean } = {}) {
    const m = createWorkspaceModel();
    m.live.value = view(s, opts);
    m.actions.value = { ...({} as LiveActions), motion: () => Promise.resolve(null), disconnect: () => undefined } as LiveActions;
    return m;
  }

  it('read only: the card with Update firmware at the top, no zero or go-to-zero drawn, no pill, no disclosure', () => {
    const html = renderToString(h(PositionPanel, { model: model(snap(READ_ONLY)) }));
    expect(html).toContain('data-region="control-block"');
    expect(html).toContain('data-block="not-approved"');
    expect(html).toContain('(450.02, no build id)');
    expect(html).toContain('data-action="block-update"');
    expect(html).not.toContain('data-machine-control="zero"');
    expect(html).not.toContain('data-position="gate"');
    expect(html).not.toContain('Where these numbers come from');
    expect(html).toContain('data-position="status"');
  });

  it('UNKNOWN: one question on connect with real buttons (no banner); the panel keeps a small way back to it, and no zero actions', () => {
    const m = model(snap({ base: 'CONNECTED_UNKNOWN', overlays: ['UNKNOWN'], primaryOverlay: 'UNKNOWN' }));
    const html = renderToString(h(PositionPanel, { model: m }));
    expect(html).toMatch(/data-position="unknown"[\s\S]*data-action="unknown-ask"[^>]*>Check…</);
    expect(html).not.toContain('data-machine-control="zero"');
    const modal = renderToString(h(UnknownModal, { model: m }));
    expect(modal).toContain('Has the machine moved since last time?');
    expect(modal).toMatch(/data-action="unknown-verify"[^>]*>It hasn't moved</);
    expect(modal).toContain('data-action="unknown-later"');
  });

  it('read only and UNKNOWN together: the card, and "I’ve checked the machine" still clears UNKNOWN without motion', () => {
    const m = model(snap({ ...READ_ONLY, overlays: ['READ_ONLY', 'UNKNOWN'], primaryOverlay: 'UNKNOWN' }));
    expect(renderToString(h(PositionPanel, { model: m }))).toContain('data-block="not-approved"');
    const modal = renderToString(h(UnknownModal, { model: m }));
    expect(modal).toContain('data-action="unknown-verify"');
    expect(modal).not.toContain('data-action="unknown-home"');
  });

  it('another tab controls the machine: the card says so', () => {
    observingElsewhere.value = true;
    try {
      const m = createWorkspaceModel();
      const html = renderToString(h(PositionPanel, { model: m }));
      expect(html).toContain('data-block="observer"');
      expect(html).toContain('Another tab controls the machine.');
    } finally {
      observingElsewhere.value = false;
    }
  });

  it('a normal board: one plain status line, "G54 · Not homed · Tool T0", with the X, Y and Z actions on its row', () => {
    const html = renderToString(h(PositionPanel, { model: model(snap()) }));
    expect(html).not.toContain('data-region="control-block"');
    // The words of the line, without the help copy that opens from "Not homed" (W34).
    const start = html.indexOf('<span class="pos-status-line"');
    const line = html.slice(start, html.indexOf('<span class="dro-actions', start)).replace(/<span class="help-copy"[\s\S]*?<\/span>/, '');
    // Simple adds the work units at the end.
    expect(line.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).toMatch(/^G54 · Not homed · Tool T0 · Work in mm/);
    expect(html).not.toContain('class="tag');
    expect(html).toContain('help-trigger help-words');
    // The all-axes actions sit in the status row, in the actions column.
    expect(html).toMatch(/class="dro-row pos-status-row"[\s\S]*class="dro-actions pos-all"/);
    expect((html.match(/data-machine-control="zero"/g) ?? []).length).toBe(8);
  });
});
