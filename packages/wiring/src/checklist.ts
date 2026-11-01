/**
 * The print checklist (RUN_PLAN §7.3; TOOLS_PLAN §6.5 "Output").
 *
 * Power off while wiring, meter polarity, motors connected only with power
 * off, the trimpot range and the VREF target. The VREF number is printed only
 * when the board data has a sense resistor value; otherwise the formula is
 * shown with RSENSE as a labelled unknown (B-DRV-1).
 */
import { driverRating, type WiringBoard } from './board.ts';
import type { Diagram } from './diagram.ts';

export interface ChecklistItem {
  readonly id: string;
  readonly text: string;
  readonly src: string;
}

const VREF_SRC = 'TI DRV8818 SLVSAX9G §6.3.2, equation 1: ICHOP = VREF / (8 × RSENSE)';

/** The sense resistor in ohms from the board's `senseResistors` rating, if it states one. */
export function senseResistorOhms(board: WiringBoard): { readonly ohms: number; readonly src: string } | undefined {
  const r = board.ratings?.find((x) => x.id === 'senseResistors');
  const m = r === undefined ? null : /(\d+(?:\.\d+)?)\s*Ohm/i.exec(r.value);
  return r === undefined || m === null ? undefined : { ohms: Number(m[1]), src: r.src };
}

export function checklist(diagram: Diagram, board: WiringBoard): readonly ChecklistItem[] {
  const items: ChecklistItem[] = [
    { id: 'power-off', text: 'Switch off and unplug every supply before wiring. Keep power off until the last step.', src: 'TOOLS_PLAN §6.5 checklist' },
    { id: 'meter', text: 'Check the polarity and voltage of every supply with a meter before connecting it to the board.', src: 'TOOLS_PLAN §6.5 checklist' },
    {
      id: 'motors-power-off',
      text: 'Connect or disconnect motors only with power off: power off, connect the motors, then power on. Never plug or unplug a motor with power on.',
      src: 'SAFETY C6 note; CIT-3',
    },
  ];
  if (board.family === 'tinyg') items.push({ id: 'phase-order', text: 'Wire the motor phases by the labels printed on the board; the diagram follows the board print.', src: 'TOOLS_PLAN §6.5 (TinyG v8 phase order not verified)' });
  const drv = driverRating(board);
  if (drv !== undefined) {
    items.push({
      id: 'trimpot',
      text: 'Turn the current trimpots only within their range: about 8 o’clock to about 4 o’clock (270 degrees). Never force them past the stops.',
      src: 'TinyG.wiki TinyG-Tuning.md:23; Connecting-TinyG.md:144',
    });
    const rs = senseResistorOhms(board);
    for (const s of diagram.parts.filter((p) => p.kind === 'stepper')) {
      const amps = Math.min(Number(s.props['currentA']), drv.maxA);
      const name = s.label || s.id;
      items.push(
        rs === undefined
          ? { id: `vref-${s.id}`, text: `${name}: VREF = ${amps} A × 8 × RSENSE. RSENSE is not known for this board (B-DRV-1), so no VREF number is given.`, src: VREF_SRC }
          : { id: `vref-${s.id}`, text: `${name}: VREF = ${amps} A × 8 × ${rs.ohms} Ω = ${(amps * 8 * rs.ohms).toFixed(3)} V.`, src: `${VREF_SRC}; RSENSE ${rs.src}` },
      );
    }
  }
  items.push({ id: 'power-on', text: 'Check every connection against the wire table, then power on.', src: 'TOOLS_PLAN §6.5 checklist' });
  return items;
}
