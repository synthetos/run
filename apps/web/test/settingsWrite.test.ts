/**
 * Settings writes in the window (SAFETY §4.6, H57-H63, T-S95..T-S99,
 * amendment 2026-11-02): the apply sequencer (backup first, one write at a
 * time with its result awaited, communication settings last, stop at the
 * first failure, revert from the backup), the gate that enables the settings
 * controls (phase switch on, approved, idle), and the controls themselves.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { changeRisk, type PlannedChange } from '@synthetos/schema';
import { SettingsApplier, type ApplyDeps, type ApplyState } from '../src/live/settingsApply.ts';
import type { BackupFile } from '../src/live/backup.ts';
import { createWorkspaceModel, INITIAL_LIVE_VIEW, type LiveView } from '../src/workspace/model.ts';
import { clearDraft, draftStore, setDraft } from '../src/workspace/boardFacts.ts';
import { pendingPlan, settingsWriteBlocked, writableKey } from '../src/workspace/settings/pending.ts';
import { ApplyConfirm, PendingTray, SettingsTable, stageRestore } from '../src/workspace/settings/SettingsUi.ts';

type Snapshot = NonNullable<LiveView['message']>['snapshot'];
type SettingWrite = NonNullable<Snapshot['settingWrite']>;

function snap(extra: Partial<Snapshot> = {}): Snapshot {
  return {
    base: 'CONNECTED_UNKNOWN',
    overlays: [],
    primaryOverlay: null,
    epoch: 1,
    port: null,
    probe: null,
    identity: { fb: 450.01, fv: 0.97, hp: 1, hv: 8, id: 'SIM-EN-0001' },
    classification: { dialectId: 'tinyg-en', mode: 'full', reason: 'en-approved', detail: '', upgradeOffer: false },
    footerRev: 3,
    live: { machineClass: 'idle', stat: 1, vel: 0, hold: 0, pos: {}, mpo: {} },
    values: {},
    fault: null,
    ackVerifying: false,
    blocked: null,
    notices: { adviseEstop: false },
    xoff: false,
    lastAckAt: null,
    stale: null,
    sent: { lines: 0, realtime: 0 },
    settingWrite: null,
    ...extra,
  } as unknown as Snapshot;
}

const BOARD = { xvm: 16000, xfr: 2000, xtn: 0, xtm: 300, st: 0, xsn: 3, xsx: 2, ysn: 3, ysx: 2, zsn: 0, zsx: 3, asn: 0, asx: 0, '1po': 0, ee: 0, jv: 4 };

function view(s: Snapshot | null, settingsWrites = true, settings: Record<string, number> = BOARD): LiveView {
  if (s === null) return INITIAL_LIVE_VIEW;
  return {
    ...INITIAL_LIVE_VIEW,
    message: { v: 3, kind: 'snapshot', snapshot: s, dro: { axes: [], machineSource: { label: 'status report', at: null, ageMs: null, lag: 'none' }, workSource: { label: 'status report' }, units: 'mm', wcs: { code: null, offsets: null, total: null }, marker: null }, lag: { amberMs: 1000, redMs: 2000 }, motion: false, settingsWrites } as LiveView['message'],
    readout: { dialectId: 'tinyg-en', phase: { kind: 'recorded', hash: 'h' }, settings },
  };
}

function change(key: string, from: number, to: number, label = key): PlannedChange {
  return { key, label, from, to, words: `${from} → ${to}`, risk: changeRisk('tinyg-en', key, from, to) };
}

const BACKUP: BackupFile = {
  format: 'synthetos-run-settings-backup',
  version: 1,
  takenAt: '2026-11-02T12:00:00.000Z',
  reason: 'manual',
  board: { id: 'SIM-EN-0001', dialect: 'tinyg-en', fb: 450.01, fv: 0.97, hp: 1, hv: 8, fbs: null },
  units: { unit: 1, label: 'mm', g21Sent: false, note: '' },
  method: '',
  groups: {},
  tokens: { ...BOARD },
  unanswered: [],
};

/** A fake worker: each write gets an id; the test decides each result by pushing a snapshot. */
class Rig {
  readonly calls: string[] = [];
  readonly states: ApplyState[] = [];
  id = 0;
  backups = 0;
  failBackup = false;
  pending: { id: number; key: string; value: number }[] = [];
  readonly timers = new Map<number, () => void>();
  #t = 0;
  applier: SettingsApplier;
  epoch = 1;

  constructor() {
    const deps: ApplyDeps = {
      writeSetting: async (key, value) => {
        this.calls.push(`write ${key}=${value}`);
        this.id += 1;
        this.pending.push({ id: this.id, key, value });
        return { ok: true, id: this.id };
      },
      backup: async () => {
        this.calls.push('backup');
        this.backups += 1;
        if (this.failBackup) throw new Error('the board did not answer');
        return BACKUP;
      },
      saveBackup: async (file) => {
        this.calls.push('save');
        return `saved-${file.takenAt}`;
      },
      setTimeout: (fn) => {
        const id = ++this.#t;
        this.timers.set(id, fn);
        return id;
      },
      clearTimeout: (handle) => {
        this.timers.delete(handle as number);
      },
      onChange: (s) => this.states.push(s),
    };
    this.applier = new SettingsApplier(deps);
    this.applier.onSnapshot(snap());
  }

  /** Finishes the oldest pending write with `outcome`. */
  finish(outcome: SettingWrite['outcome'], detail = ''): void {
    const p = this.pending.shift();
    if (p === undefined) throw new Error('no pending write');
    this.applier.onSnapshot(snap({ epoch: this.epoch, settingWrite: { id: p.id, key: p.key, value: p.value, phase: 'done', gate: {}, outcome, detail } as SettingWrite }));
  }
}

const tick = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('the apply sequencer', () => {
  it('backs up first, then writes one setting at a time, each only after the previous result', async () => {
    const rig = new Rig();
    const run = rig.applier.apply([change('xvm', 16000, 15000), change('xfr', 2000, 1800)]);
    await tick();
    expect(rig.calls).toEqual(['backup', 'save', 'write xvm=15000']);
    await tick();
    expect(rig.calls).toHaveLength(3); // the second write waits for the first result
    rig.finish('verified');
    await tick();
    expect(rig.calls.at(-1)).toBe('write xfr=1800');
    rig.finish('verified');
    const end = await run;
    expect(end).toMatchObject({ kind: 'done', mode: 'apply', backupName: 'saved-2026-11-02T12:00:00.000Z' });
    if (end.kind !== 'done') throw new Error();
    expect(end.steps.map((s) => s.status)).toEqual(['verified', 'verified']);
  });

  it('writes nothing when the backup cannot be completed', async () => {
    const rig = new Rig();
    rig.failBackup = true;
    const end = await rig.applier.apply([change('xvm', 16000, 15000)]);
    expect(end).toMatchObject({ kind: 'failed', revertable: false });
    if (end.kind === 'failed') expect(end.message).toMatch(/Nothing was written: the backup could not be completed/);
    expect(rig.calls.filter((c) => c.startsWith('write'))).toEqual([]);
  });

  it('puts communication settings last and jv very last', async () => {
    const rig = new Rig();
    const run = rig.applier.apply([change('jv', 4, 3), change('ee', 0, 1), change('xvm', 16000, 15000)]);
    for (let i = 0; i < 3; i++) {
      await tick();
      rig.finish('verified');
    }
    await run;
    expect(rig.calls.filter((c) => c.startsWith('write'))).toEqual(['write xvm=15000', 'write ee=1', 'write jv=3']);
  });

  it('stops at the first failure, marks the rest not written, and offers revert; revert writes the backed-up values back', async () => {
    const rig = new Rig();
    const run = rig.applier.apply([change('xvm', 16000, 15000), change('xfr', 2000, 1800), change('xtm', 300, 280)]);
    await tick();
    rig.finish('verified');
    await tick();
    rig.finish('mismatch', 'Written, but the board reads back 1700, not 1800.');
    const end = await run;
    expect(end).toMatchObject({ kind: 'failed', mode: 'apply', revertable: true });
    if (end.kind !== 'failed') throw new Error();
    expect(end.steps.map((s) => s.status)).toEqual(['verified', 'failed', 'notRun']);
    expect(end.message).toMatch(/Stopped at the first problem/);
    expect(rig.calls.filter((c) => c.startsWith('write'))).toEqual(['write xvm=15000', 'write xfr=1800']);

    const back = rig.applier.revert();
    await tick();
    rig.finish('verified');
    await tick();
    rig.finish('verified');
    const reverted = await back;
    expect(reverted).toMatchObject({ kind: 'done', mode: 'revert' });
    // Both the verified write and the mismatched one (it may have been stored) are written back from the backup.
    expect(rig.calls.filter((c) => c.startsWith('write')).slice(2)).toEqual(['write xvm=16000', 'write xfr=2000']);
    expect(rig.backups).toBe(1);
  });

  it('a refused first write changed nothing: no revert is offered', async () => {
    const rig = new Rig();
    const run = rig.applier.apply([change('xvm', 16000, 15000)]);
    await tick();
    rig.finish('refused', 'Not written: the board must be idle.');
    const end = await run;
    expect(end).toMatchObject({ kind: 'failed', revertable: false });
  });

  it('a link change or no result in time stops the run', async () => {
    const rig = new Rig();
    const run = rig.applier.apply([change('xvm', 16000, 15000), change('xfr', 2000, 1800)]);
    await tick();
    rig.applier.onSnapshot(snap({ epoch: 2 }));
    expect(await run).toMatchObject({ kind: 'failed' });

    const slow = new Rig();
    const late = slow.applier.apply([change('xvm', 16000, 15000)]);
    await tick();
    for (const fn of [...slow.timers.values()]) fn();
    const end = await late;
    expect(end).toMatchObject({ kind: 'failed' });
    if (end.kind === 'failed') expect(end.steps[0]?.outcome).toBe('unconfirmed');
  });
});

describe('the settings controls gate (enabled only with the phase switch on and the machine idle)', () => {
  it('blocks with plain words for every state that is not an approved, idle, read board', () => {
    expect(settingsWriteBlocked(null)).toMatch(/Connect a board/);
    expect(settingsWriteBlocked(view(snap(), false))).toMatch(/not turned on in this build/);
    expect(settingsWriteBlocked(view(snap({ overlays: ['READ_ONLY'], classification: { dialectId: 'tinyg-en', mode: 'readOnly', reason: 'en-not-approved', detail: '', upgradeOffer: false } } as Partial<Snapshot>)))).toMatch(/read-only/);
    expect(settingsWriteBlocked(view(snap({ overlays: ['ORPHANED_MOTION'] } as Partial<Snapshot>)))).toMatch(/motion left/);
    expect(settingsWriteBlocked(view(snap({ overlays: ['FAULT'] } as Partial<Snapshot>)))).toMatch(/fault/);
    expect(settingsWriteBlocked(view(snap({ overlays: ['UNKNOWN'] } as Partial<Snapshot>)))).toMatch(/not trusted/);
    expect(settingsWriteBlocked(view(snap({ overlays: ['STALE'] } as Partial<Snapshot>)))).toMatch(/stopped answering/);
    expect(settingsWriteBlocked(view(snap({ live: { machineClass: 'running', stat: 5, vel: 100, pos: {}, mpo: {} } } as Partial<Snapshot>)))).toMatch(/running/);
    expect(settingsWriteBlocked(view(snap({ live: { machineClass: 'idle', stat: 1, vel: 3, pos: {}, mpo: {} } } as Partial<Snapshot>)))).toMatch(/moving/);
    expect(settingsWriteBlocked(view(snap({ live: { machineClass: 'idle', stat: 1, vel: 0, hold: 4, pos: {}, mpo: {} } } as Partial<Snapshot>)))).toMatch(/holding/);
    expect(settingsWriteBlocked(view(snap(), true, {}))).toMatch(/settings read/);
    expect(settingsWriteBlocked(view(snap()))).toBeNull();
  });

  it('only reviewed, non-forbidden keys can be edited', () => {
    expect(writableKey('xvm', 'tinyg-en')).toBe(true);
    expect(writableKey('st', 'tinyg-en')).toBe(true);
    for (const k of ['hv', 'fb', 'id', 'baud', 'ex', 'ej', 'jv', 'rxm', 'js', 'ee', 'ec', 'si', 'spe', 'rthb']) expect(writableKey(k, 'tinyg-en'), k).toBe(false);
    expect(writableKey('xvm', 'tinyg-449-stock')).toBe(false);
    expect(writableKey('xvm', null)).toBe(false);
  });

  it('the Apply control is disabled unless the switch is on and the machine idle; it lists the diff and high-risk rows', () => {
    clearDraft();
    setDraft('xfr', 1800);
    setDraft('st', 1);
    const render = (v: LiveView): string => {
      const model = createWorkspaceModel();
      model.live.value = v;
      return renderToString(h(PendingTray, { model }));
    };
    const apply = (html: string): string => /<button[^>]*data-action="apply-settings"[^>]*>/.exec(html)?.[0] ?? '';
    const ready = render(view(snap()));
    expect(apply(ready)).not.toMatch(/\sdisabled/);
    expect(apply(ready)).toMatch(/data-machine-control="settings-write"/);
    expect(ready).toMatch(/data-pending-key="xfr"/);
    expect(ready).toMatch(/data-pending-key="st"[^>]*class="high-risk"/);
    expect(ready).toMatch(/always pressed or never pressed/);
    for (const v of [view(snap(), false), view(snap({ overlays: ['READ_ONLY'] } as Partial<Snapshot>)), view(snap({ live: { machineClass: 'running', stat: 5, vel: 100, pos: {}, mpo: {} } } as Partial<Snapshot>)), view(snap({ overlays: ['UNKNOWN'] } as Partial<Snapshot>))]) {
      expect(apply(render(v))).toMatch(/\sdisabled/);
    }
    // The plan orders and screens the drafts against the board.
    const plan = pendingPlan(view(snap()));
    expect(plan?.ok && plan.changes.map((c) => c.key)).toEqual(['xfr', 'st']);
    clearDraft();
    expect(render(view(snap()))).toBe('');
  });

  it('the high-risk confirmation names each consequence and needs a tick each plus the typed word; Cancel comes first', () => {
    const html = renderToString(h(ApplyConfirm, { changes: [change('st', 0, 1, 'Switch type'), change('xfr', 2000, 1800, 'X max feed')], view: view(snap()), onCancel: () => undefined, onConfirm: () => undefined }));
    expect(html).toMatch(/Confirm high-risk changes/);
    expect(html).toMatch(/data-risk-key="st"/);
    expect(html).not.toMatch(/data-risk-key="xfr"/);
    expect(html).toMatch(/Test each switch after applying/);
    expect(html).toMatch(/Type WRITE/);
    expect(/<button[^>]*data-action="confirm-apply"[^>]*>/.exec(html)?.[0]).toMatch(/\sdisabled/);
    expect(html.indexOf('data-action="cancel-apply"')).toBeLessThan(html.indexOf('data-action="confirm-apply"'));
    expect(html).toMatch(/Write 2 settings to this board \(SIM-EN-0001\)/);
  });

  it('All settings is one grouped, searchable table with plain names, units and descriptions', () => {
    const html = renderToString(h(SettingsTable, { view: view(snap()) }));
    expect(html).toMatch(/aria-label="Search settings"/);
    expect(html).toMatch(/class="group-row"/);
    expect(html).toMatch(/data-key="xvm"/);
    expect(html).toMatch(/mm\/min/);
    expect(html).not.toMatch(/<details/);
  });

  it('restore stages a backup by token name and refuses a backup from another dialect or in inches', () => {
    clearDraft();
    const v = view(snap());
    const ok = stageRestore(JSON.stringify({ ...BACKUP, tokens: { ...BOARD, xvm: 12000, hv: 7, fb: 449 } }), v);
    expect(ok).toMatchObject({ ok: true });
    expect(draftStore.value.value).toEqual({ xvm: 12000 });
    if (ok.ok) expect(ok.result.skipped.map((s) => s.key)).toEqual(expect.arrayContaining(['fb', 'hv', 'jv']));
    expect(stageRestore(JSON.stringify({ ...BACKUP, board: { ...BACKUP.board, dialect: 'tinyg-440' } }), v)).toMatchObject({ ok: false });
    expect(stageRestore(JSON.stringify({ ...BACKUP, units: { ...BACKUP.units, unit: 0 } }), v)).toMatchObject({ ok: false });
    expect(stageRestore('not json', v)).toMatchObject({ ok: false });
    clearDraft();
  });
});
