/**
 * "Firmware update available" (owner, 2026-11-09): only a newer signed release for this board's hardware, never
 * while anything moves or over the Run step with a job loaded; "Don't show again" per board and version.
 */
import { describe, expect, it } from 'vitest';
import type { FirmwareRelease, FirmwareReleases } from '@synthetos/protocol';
import { fbText, offerText, updateOffer, type OfferInput } from '../src/firmware/updateOffer.ts';
import { OFFER_KEY, dismissOffer, offerDismissed } from '../src/firmware/offerMemory.ts';
import type { StorageLike } from '../src/workspace/storage.ts';

const rel = (fb: number, file = `tinyg-${fb.toFixed(2)}.hex`): FirmwareRelease =>
  ({ hv: 8, fb, fv: 0.97, dialect: 'tinyg-en', part: 'x192a3', file, sha256: 'a'.repeat(64), size: 1, date: '2026-11-09', changelog: '', recommended: false, simulatorOnly: false, repo: null, tag: null }) as FirmwareRelease;
const LIST = { env: 'staging', issuedMs: 0, expiresMs: 1, boards: [{ hv: 8, minimumFb: 440.21, releases: [rel(450.02), rel(451), rel(440.21)] }] } as unknown as FirmwareReleases;

type Snap = NonNullable<OfferInput['snapshot']>;
const snap = (over: Record<string, unknown> = {}): Snap => ({ base: 'IDLE_UNHOMED', overlays: [], motion: null, job: null, identity: { id: 'B-1', hv: 8, fb: 450.02 }, ...over }) as unknown as Snap;
const input = (over: Partial<OfferInput> = {}): OfferInput => ({ snapshot: snap(), flashing: false, releases: LIST, onRunStep: false, fileOpen: false, messageUp: false, ...over });

describe('updateOffer', () => {
  it('offers the newest signed release newer than the board, in words', () => {
    const offer = updateOffer(input());
    expect(offer).toMatchObject({ boardId: 'B-1', current: 450.02, release: { fb: 451 } });
    expect(offerText(offer as NonNullable<typeof offer>)).toBe('This board runs 450.02. 451.00 is released.');
    expect(fbText(451)).toBe('451.00');
    // A string hv is read as the number it is.
    expect(updateOffer(input({ snapshot: snap({ identity: { id: 'B-1', hv: '8', fb: 450.02 } }) }))?.release.fb).toBe(451);
  });

  it('nothing when the board is up to date, the list is not verified, or the board is not known', () => {
    expect(updateOffer(input({ snapshot: snap({ identity: { id: 'B-1', hv: 8, fb: 451 } }) }))).toBeNull();
    expect(updateOffer(input({ releases: null }))).toBeNull();
    expect(updateOffer(input({ snapshot: null }))).toBeNull();
    expect(updateOffer(input({ snapshot: snap({ identity: { id: 'B-1', hv: 9, fb: 1 } }) }))).toBeNull();
    expect(updateOffer(input({ snapshot: snap({ identity: { hv: 8, fb: 1 } }) }))).toBeNull();
    expect(updateOffer(input({ snapshot: snap({ identity: { id: 'B-1', hv: 8 } }) }))).toBeNull();
    expect(updateOffer(input({ snapshot: snap({ identity: null }) }))).toBeNull();
  });

  it('never during a job, a hold, homing, a jog, an alarm, an update or another machine message', () => {
    for (const base of ['RUNNING', 'HELD', 'HOMING', 'JOGGING', 'ALARM', 'STOPPING_JOB', 'PREAMBLE', 'NOT_CONNECTED']) expect(updateOffer(input({ snapshot: snap({ base }) })), base).toBeNull();
    expect(updateOffer(input({ snapshot: snap({ motion: { op: 'jog' } }) }))).toBeNull();
    expect(updateOffer(input({ flashing: true }))).toBeNull();
    expect(updateOffer(input({ snapshot: snap({ overlays: ['UNKNOWN'] }) }))).toBeNull();
    expect(updateOffer(input({ messageUp: true }))).toBeNull();
    expect(updateOffer(input({ snapshot: snap({ job: { phase: 'running' } }) }))).toBeNull();
  });

  it('waits over the Run step while a job is loaded there; a finished job does not hold it back', () => {
    expect(updateOffer(input({ onRunStep: true, snapshot: snap({ job: { phase: 'ready' } }) }))).toBeNull();
    expect(updateOffer(input({ onRunStep: false, snapshot: snap({ job: { phase: 'ready' } }) }))).not.toBeNull();
    expect(updateOffer(input({ onRunStep: true, snapshot: snap({ job: { phase: 'done' } }) }))).not.toBeNull();
    expect(updateOffer(input({ onRunStep: true }))).not.toBeNull();
    // A file open on the Run step waits too (it is loaded to the board and may be started); elsewhere it does not.
    expect(updateOffer(input({ onRunStep: true, fileOpen: true }))).toBeNull();
    expect(updateOffer(input({ onRunStep: false, fileOpen: true }))).not.toBeNull();
  });
});

describe('offer memory', () => {
  function memory(): StorageLike & { readonly data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it('"Don\'t show again" is per board and version', () => {
    const s = memory();
    expect(offerDismissed('B-1', '451.00', s)).toBe(false);
    expect(dismissOffer('B-1', '451.00', s)).toBe(true);
    expect(dismissOffer('B-1', '451.00', s)).toBe(true);
    expect(offerDismissed('B-1', '451.00', s)).toBe(true);
    expect(offerDismissed('B-1', '452.00', s)).toBe(false);
    expect(offerDismissed('B-2', '451.00', s)).toBe(false);
    expect(JSON.parse(s.data.get(OFFER_KEY) as string)).toEqual({ 'B-1': ['451.00'] });
  });

  it('missing, throwing or junk storage: never dismissed, and the write says it did not keep', () => {
    expect(offerDismissed('B-1', '451.00', null)).toBe(false);
    expect(dismissOffer('B-1', '451.00', null)).toBe(false);
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(offerDismissed('B-1', '451.00', throwing)).toBe(false);
    expect(dismissOffer('B-1', '451.00', throwing)).toBe(false);
    const junk = memory();
    junk.setItem(OFFER_KEY, '[1,2]');
    expect(offerDismissed('B-1', '451.00', junk)).toBe(false);
    junk.setItem(OFFER_KEY, '{"B-1":"451.00","B-2":["451.00",7]}');
    expect(offerDismissed('B-1', '451.00', junk)).toBe(false);
    expect(offerDismissed('B-2', '451.00', junk)).toBe(true);
    expect(() => offerDismissed('B-1', '451.00')).not.toThrow();
  });
});
