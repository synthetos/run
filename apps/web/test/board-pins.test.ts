/** Pins used by the Board illustration come from the generated board definition. */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { tinygV8, v8Pins } from '../src/workspace/boardFacts.ts';
import { PinCard } from '../src/workspace/views/board/pin.ts';
import { root, text } from './tree.ts';
import { boardView } from './boardViews.ts';


describe('TinyG v8 pins', () => {
  it('lists every connector pin of the board definition with its own label, plus four terminals per motor', () => {
    const board = tinygV8();
    expect(board).not.toBeNull();
    const pins = v8Pins();
    for (const c of board?.connectors ?? []) for (const p of c.pins) expect(pins.find((x) => x.ref === `${c.id}.${p.n}`)?.label).toBe(p.label);
    expect(pins.filter((p) => p.role === 'motor')).toHaveLength(16);
    const spin = pins.find((p) => p.signal === 'out.spindleEnable');
    expect(spin).toMatchObject({ ref: 'J6.3', label: 'Spindle', mcu: 'PA5' });
    expect(spin?.keys).toContain('spep');
    expect(pins.find((p) => p.ref === 'J7.3')).toMatchObject({ label: 'Xmin', function: 'X minimum switch input', keys: ['xsn', 'st'] });
    expect(pins.find((p) => p.signal === 'out.coolant')?.note).toMatch(/share/);
  });

  it('the pin card names an input by its one name from the settings file (review finding 10)', () => {
    const pin = v8Pins().find((p) => p.ref === 'J7.3')!;
    const card = text(root(h(PinCard, { pin, view: boardView(), onClose: () => undefined })));
    expect(card).toContain('X min switch');
    expect(card).not.toContain('X minimum switch input');
  });
});