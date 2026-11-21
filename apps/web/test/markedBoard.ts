/**
 * A board marked after a failed update, on the test kit's flashable board, with a machine-worker host (bannerWait and
 * markProbe tests). `frozen`: the firmware runs but answers nothing (it only starts again, with its banner, after a
 * reset), so only a banner can prove it.
 */
import { expect } from 'vitest';
import type { PortSelector, TransportSource } from '@synthetos/machine';
import { PHASE_1_RELEASE } from '@synthetos/safety';
import { FlashableBoard, SimEndpoint, VirtualClock, type FlashableBoardOptions } from '@synthetos/testkit';
import { memoryBootloaderMarks } from '../src/machine-worker/bootloaderMark.ts';
import { MachineWorkerHost } from '../src/machine-worker/host.ts';
import type { MachineReply } from '../src/machine-worker/rpc.ts';
import { SimTransport } from './simTransport.ts';

export const PORT: PortSelector = Object.freeze({ usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 });
export const BOARD = 'SIM-EN-0001';
export const OPEN = { v: 3, kind: 'open', port: PORT, boardId: null, previousSessionEnded: false };
export const SAVED_VIEW = { id: 1, phase: 'failed', done: 3, of: 10, note: null, source: 'release', target: { fb: 450.02, label: '450.02', sha256: 'x' }, boardId: BOARD, board: { id: BOARD, hv: 99, fb: 450.01, fv: 0.97 }, countdown: null, wrote: false, message: null, recoveryOffered: true, versionCheck: null, result: null };

interface WireLine { readonly t: number; readonly dir: 'tx' | 'rx'; readonly hex: string }

export interface MarkedBoardOptions {
  /** The board id the mark recorded. */
  readonly markedId: string | null;
  /** The fact the mark recorded (undefined: a mark saved before marks recorded it). */
  readonly wrote?: boolean;
  readonly frozen?: boolean;
  readonly kind?: 'detected' | 'failed';
  readonly board?: FlashableBoardOptions;
}

export async function markedBoard(o: MarkedBoardOptions) {
  const clock = new VirtualClock();
  const board = new FlashableBoard({ model: { bootMs: 50, eepromWriteMs: 0 }, linkBaud: 2_000_000, ...o.board });
  const endpoint = new SimEndpoint({ clock, device: board, link: { baudRate: 2_000_000, latencyMs: 0.2, coalesceMs: 2 } });
  if (o.frozen === true) board.applicationFrozen = true;
  const source: TransportSource = { kind: 'fake', request: async () => (endpoint.connected ? new SimTransport(endpoint, clock, { open: 0, most: 0 }, 0) : null) };
  const marks = memoryBootloaderMarks();
  await marks.put({ nonce: 'failed-update', kind: o.kind ?? 'failed', port: PORT, boardId: o.markedId, recovery: { begin: null, view: SAVED_VIEW }, ...(o.wrote === undefined ? {} : { wrote: o.wrote }) });
  const host = new MachineWorkerHost(source, clock, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130' }, null, PHASE_1_RELEASE, marks);
  const waits: unknown[] = [];
  host.flashListener = () => waits.push(host.flash.view?.bannerWait ?? null);
  /** Runs virtual time until `done()` (or the limit). */
  const until = async (done: () => boolean, limitMs = 30_000): Promise<boolean> => {
    const end = clock.now() + limitMs;
    while (!done() && clock.now() < end) {
      for (let i = 0; i < 40; i++) await Promise.resolve();
      if (!done()) clock.advanceTo(Math.min(clock.nextAt() ?? end, end));
    }
    return done();
  };
  /** Runs virtual time until the reply arrives (or the limit). */
  const call = async (request: unknown, limitMs = 120_000): Promise<MachineReply | 'pending'> => {
    let reply: MachineReply | 'pending' = 'pending';
    void host.handle(request).then((r) => (reply = r));
    await until(() => reply !== 'pending', limitMs);
    return reply;
  };
  const succeeds = async (request: unknown): Promise<void> => {
    const reply = await call(request);
    expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
  };
  const lines = (): WireLine[] => (host.flash.flashTranscript()?.jsonl ?? '').trim().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as WireLine);
  /** The flash transcript's writes up to the first banner received. */
  const writesBeforeBanner = (): string[] => {
    let text = '';
    const all = lines();
    const bannerAt = all.find((l) => l.dir === 'rx' && (text += Buffer.from(l.hex, 'hex').toString('latin1')).includes('"fb":'))?.t ?? Infinity;
    return all.filter((l) => l.dir === 'tx' && l.t <= bannerAt).map((l) => l.hex);
  };
  /** Every write on the bootloader link, in order. */
  const writes = (): string[] => lines().filter((l) => l.dir === 'tx').map((l) => l.hex);
  return { clock, board, endpoint, marks, host, waits, call, succeeds, until, writesBeforeBanner, writes };
}
