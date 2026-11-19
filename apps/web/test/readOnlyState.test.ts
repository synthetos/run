/**
 * Read-only states in a few words (owner, 2026-11-18, pictures 149 and 150): the strip never runs on, the Position
 * card says the state and the way out, and the long reason sits behind the card's "?".
 */
import { describe, expect, it } from 'vitest';
import type { FirmwareRelease, FirmwareReleases } from '@synthetos/protocol';
import { w50 } from '@synthetos/safety';
import { readOnlyCard, readOnlyPhrase, readOnlyPill, readOnlyStrip, updateFixes } from '../src/workspace/readOnlyState.ts';
import type { LiveView } from '../src/workspace/model.ts';
import { stripStatus } from '../src/workspace/status.ts';
import { snap, view } from './runMotionHarness.ts';

describe('review finding 2: the old-firmware strip (the owner\'s real 449.01 once the list loads)', () => {
  it('says "Update required" like the Position card, keeps W50 unchanged, and opens it from the pill', () => {
    const v = view(snap({ identity: { id: 'B-1', hv: 8, fb: 449.01 } }), false);
    const old = { ...v, message: { ...v.message, oldFirmware: { fb: 449.01, minimumFb: 450.02 } } } as unknown as LiveView;
    const s = stripStatus(old, null);
    const words = w50({ fb: '449.01', minimum: '450.02' });
    expect(s.title).toBe('Firmware update needed');
    expect(s.pill).toEqual({ text: 'Update required', tone: 'warn', help: words });
    expect(s.text).toBe(words);
  });
});

type Snapshot = NonNullable<LiveView['message']>['snapshot'];

const rel = (fb: number): FirmwareRelease =>
  ({ hv: 8, fb, fv: 0.97, dialect: 'tinyg-en', part: 'x192a3', file: `tinyg-${fb.toFixed(2)}.hex`, sha256: 'a'.repeat(64), size: 1, date: '2026-11-09', changelog: '', recommended: false, simulatorOnly: false, repo: null, tag: null }) as FirmwareRelease;
const LIST = { env: 'staging', issuedMs: 0, expiresMs: 1, boards: [{ hv: 8, minimumFb: 450.02, releases: [rel(450.02), rel(450.06)] }] } as unknown as FirmwareReleases;

function ro(classification: Record<string, unknown>, extra: Record<string, unknown> = {}): Snapshot {
  return {
    base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'], identity: { fb: 450.02, hv: 8, id: 'B-1' },
    classification: { upgradeOffer: false, detail: '', ...classification },
    live: { stat: 3 }, values: {}, notices: { adviseEstop: false }, motion: null, job: null, ...extra,
  } as unknown as Snapshot;
}

const STOCK = ro({ dialectId: 'tinyg-449-stock', mode: 'readOnly', reason: 'stock-449' }, { identity: { fb: 449.01, hv: 8, id: 'B-1' } });

describe('an update fixes it (stock 449, an unapproved TinyG build)', () => {
  it('owner 149: pill "Update required", strip "Firmware 449.01 → 450.06"', () => {
    expect(updateFixes(STOCK)).toBe(true);
    expect(readOnlyPill(STOCK)).toBe('Update required');
    expect(readOnlyStrip(STOCK, LIST)).toBe('Firmware 449.01 → 450.06');
    expect(readOnlyStrip(STOCK, null)).toBe('Firmware 449.01 · update required');
    // Review minor 6: a build and hardware reported as text still name the target.
    expect(readOnlyStrip({ ...STOCK, identity: { fb: '449.01', hv: '8', id: 'B-1' } } as unknown as Snapshot, LIST)).toBe('Firmware 449.01 → 450.06');
  });
  it('owner 150: card title "Update required" and one short line naming the target', () => {
    expect(readOnlyCard(STOCK, LIST)).toEqual({ title: 'Update required', line: '449.01 is read only in Run. Install 450.06.' });
    expect(readOnlyCard(STOCK, null)).toEqual({ title: 'Update required', line: '449.01 is read only in Run. Install the newest release.' });
  });
  it('the refusal text is short too', () => {
    expect(readOnlyPhrase(STOCK)).toBe('firmware 449.01 needs an update');
    for (const reason of ['en-not-approved', 'tg440-not-approved']) expect(updateFixes(ro({ dialectId: 'tinyg-en', mode: 'readOnly', reason }))).toBe(true);
  });
});

describe('every other read-only reason', () => {
  const cases: [string, Snapshot, string, string][] = [
    ['flow control, ex unknown to Run', ro({ dialectId: 'tinyg-en', mode: 'readOnly', reason: 'flowControl' }, { live: { stat: 3, ex: 3 } }), 'Flow control', 'flow control ex = 3 is not supported'],
    ['flow control, ex not read', ro({ dialectId: 'tinyg-en', mode: 'readOnly', reason: 'flowControl' }), 'Flow control', 'flow control (ex) not read'],
    ['g2core', ro({ dialectId: 'g2core-edge', mode: 'readOnly', reason: 'g2core-read-only' }), 'Read only', 'Run does not control g2core yet'],
    ['unknown g2core build', ro({ dialectId: null, mode: 'readOnly', reason: 'g2core-unknown-build' }, { identity: { fb: 101.5 } }), 'Unknown build', 'unknown g2core build 101.50'],
    ['probe failed', ro({ dialectId: null, mode: 'readOnly', reason: 'probeFailed' }, { identity: {} }), 'Not identified', 'board identity not read'],
    ['conflict', ro({ dialectId: null, mode: 'readOnly', reason: 'conflict' }), 'Not identified', 'firmware not identified'],
  ];
  it('a short pill, a short strip text and a short refusal; no update claim', () => {
    for (const [name, s, pill, phrase] of cases) {
      expect(updateFixes(s), name).toBe(false);
      expect(readOnlyPill(s), name).toBe(pill);
      expect(readOnlyPhrase(s), name).toBe(phrase);
      expect(readOnlyStrip(s, LIST), name).toBe(phrase.charAt(0).toUpperCase() + phrase.slice(1));
    }
  });
  it('card titles are short and leave the how-to-fix lines to the card', () => {
    expect(readOnlyCard(cases[0]![1], LIST).title).toBe('Flow control not supported');
    expect(readOnlyCard(cases[1]![1], LIST).title).toBe('Flow control not read');
    expect(readOnlyCard(cases[2]![1], LIST).title).toBe('g2core is read only');
    expect(readOnlyCard(cases[3]![1], LIST).title).toBe('Unknown g2core build');
    expect(readOnlyCard(cases[4]![1], LIST).title).toBe('Board not identified');
    for (const [, s] of cases) expect(readOnlyCard(s, LIST).line).toBeNull();
  });
  it('owner 149: no strip text is long enough to trail off at 1280', () => {
    const all = [STOCK, ...cases.map((c) => c[1])].flatMap((s) => [readOnlyStrip(s, LIST), readOnlyStrip(s, null)]);
    for (const text of all) expect(text.length, text).toBeLessThanOrEqual(36);
  });
});
