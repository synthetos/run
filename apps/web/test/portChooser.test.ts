/**
 * OD-3: the window's chooser answer becomes LIVE entry's ChooseResult, and
 * windowChooser calls the chooser synchronously (inside the C1 click).
 */
import { describe, expect, it } from 'vitest';
import { CHOOSER_TEXT, toChooseResult, windowChooser } from '../src/live/portChooser.ts';

/** The chooser's answer type, through portChooser.ts (the only module that may import the chooser). */
type ChooserResult = Parameters<typeof toChooseResult>[0];

describe('portChooser', () => {
  it('passes the selector through, and words every refusal', () => {
    const selector = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 };
    const confirm = async () => true;
    expect(toChooseResult({ ok: true, selector, confirm })).toEqual({ ok: true, port: selector, confirm });
    for (const code of Object.keys(CHOOSER_TEXT) as (keyof typeof CHOOSER_TEXT)[]) {
      expect(toChooseResult({ ok: false, code, detail: 'x' })).toEqual({ ok: false, message: CHOOSER_TEXT[code] });
    }
  });

  it('calls the chooser synchronously', async () => {
    const calls: string[] = [];
    const result = windowChooser(() => {
      calls.push('chooser');
      return Promise.resolve<ChooserResult>({ ok: false, code: 'cancelled', detail: '' });
    });
    expect(calls).toEqual(['chooser']);
    expect(await result).toEqual({ ok: false, message: CHOOSER_TEXT.cancelled });
  });

  it('without Web Serial (Node), the default chooser says so', async () => {
    expect(await windowChooser()).toEqual({ ok: false, message: CHOOSER_TEXT.unavailable });
  });
});
