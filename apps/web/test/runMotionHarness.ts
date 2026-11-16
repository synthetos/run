import { INITIAL_LIVE_VIEW, type LiveView } from '../src/workspace/model.ts';
export type Snapshot = NonNullable<LiveView['message']>['snapshot'];

export function snap(extra: Record<string, unknown> = {}): Snapshot {
  return {
    base: 'IDLE_UNHOMED',
    overlays: [],
    primaryOverlay: null,
    epoch: 1,
    port: null,
    probe: null,
    identity: { fb: 450.01, fv: 0.97, hp: 1, hv: 8, id: 'SIM-EN-0001' },
    classification: { dialectId: 'tinyg-en', mode: 'full', reason: 'en-approved', detail: '', upgradeOffer: false },
    footerRev: 3,
    live: { machineClass: 'programStop', stat: 3, hold: 0, vel: 0, home: 0, pos: {}, mpo: {} },
    values: {},
    fault: null,
    ackVerifying: false,
    blocked: null,
    notices: { adviseEstop: false },
    xoff: false,
    lastAckAt: null,
    stale: null,
    sent: { lines: 0, realtime: 0 },
    motion: null,
    ...extra,
  } as unknown as Snapshot;
}

export function view(s: Snapshot | null, flag = true, axes: { axis: string; machine: number | null; work: number | null }[] = []): LiveView {
  if (s === null) return INITIAL_LIVE_VIEW;
  return {
    ...INITIAL_LIVE_VIEW,
    message: {
      v: 3,
      kind: 'snapshot',
      snapshot: s,
      dro: { axes: axes.map((a) => ({ ...a, homed: null })), machineSource: { label: 'status report', at: null, ageMs: null, lag: 'none' }, workSource: { label: 'status report' }, units: 'mm', wcs: { code: null, offsets: null, total: null }, marker: null },
      lag: { amberMs: 1000, redMs: 2000 },
      motion: flag,
    } as unknown as LiveView['message'],
  };
}