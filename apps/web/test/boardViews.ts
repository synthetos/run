/**
 * Test helpers for the Board settings tests: a live view of a connected board
 * built from a snapshot, the way the worker sends it.
 */
import { INITIAL_LIVE_VIEW, type LiveView } from '../src/workspace/model.ts';

type Snapshot = NonNullable<LiveView['message']>['snapshot'];

export interface BoardOptions {
  readonly dialectId?: string;
  readonly fb?: number;
  readonly mode?: 'full' | 'readOnly';
  readonly readOnly?: boolean;
  readonly settingsWrites?: boolean;
  readonly unit?: number;
  readonly id?: string;
  readonly settings?: Readonly<Record<string, number | string>>;
}

export function boardSnapshot(o: BoardOptions = {}): Snapshot {
  const dialectId = o.dialectId ?? 'tinyg-en';
  return {
    base: 'CONNECTED_UNKNOWN',
    overlays: o.readOnly === true ? ['READ_ONLY'] : [],
    primaryOverlay: null,
    epoch: 1,
    port: null,
    probe: null,
    identity: { fb: o.fb ?? 450.06, fv: 0.97, hp: 1, hv: 8, id: o.id ?? 'SIM-EN-0001' },
    classification: { dialectId, mode: o.mode ?? (o.readOnly === true ? 'readOnly' : 'full'), reason: o.readOnly === true ? 'stock-449' : 'en-approved', detail: '', upgradeOffer: false },
    footerRev: 3,
    live: { machineClass: 'idle', stat: 1, vel: 0, hold: 0, pos: {}, mpo: {}, ...(o.unit === undefined ? {} : { unit: o.unit }) },
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
  } as unknown as Snapshot;
}

/** The owner's 449.01 board (pictures 152-157), read only. */
export const OWNER_449 = { dialectId: 'tinyg-449-stock', fb: 449.01, readOnly: true } as const;

export function boardView(o: BoardOptions = {}): LiveView {
  const s = boardSnapshot(o);
  return {
    ...INITIAL_LIVE_VIEW,
    message: {
      v: 3,
      kind: 'snapshot',
      snapshot: s,
      dro: { axes: [], machineSource: { label: 'status report', at: null, ageMs: null, lag: 'none' }, workSource: { label: 'status report' }, units: 'mm', wcs: { code: null, offsets: null, total: null }, marker: null },
      lag: { amberMs: 1000, redMs: 2000 },
      motion: false,
      settingsWrites: o.settingsWrites ?? true,
    } as LiveView['message'],
    readout: { dialectId: o.dialectId ?? 'tinyg-en', phase: { kind: 'recorded', hash: 'h' }, settings: o.settings ?? { xsn: 1, '1mi': 8, xjd: 0.05, st: 0, ex: 1 } },
  };
}
