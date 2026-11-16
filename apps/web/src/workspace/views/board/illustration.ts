import type { SettingValue } from '@synthetos/schema';
import { h, type ComponentChild } from 'preact';
import { useState, type Dispatch, type StateUpdater } from 'preact/hooks';
import {
  AXIS_NAMES,
  connectorLabel,
  connectorPins,
  pinByRef,
  type PinInfo
} from '../../boardFacts.ts';
import { type Settings } from './shared.ts';

/** The TinyG v8 drawing (OD-5: connector positions as derived public facts; pin names from the board definition). */
export function BoardIllustration({ selected, onSelect, settings }: { readonly selected: string | null; readonly onSelect: (ref: string) => void; readonly settings: Settings }): ComponentChild {
  const [hover, setHover] = useState<string | null>(null);
  const target = pinTarget({ selected, onSelect, setHover });
  const header = headerPins({ target });
  const motor = motorPins({ settings, target });
  const power = connectorPins('J1');
  const tipPin = hover === null ? null : pinByRef(hover);
  const tipAt = (ref: string): { x: number; y: number } => {
    const [c, n] = ref.split('.') as [string, string];
    const i = Number(n) - 1;
    if (c === 'J8') return { x: 159 + i * 22, y: 150 };
    if (c === 'J7') return { x: 324 + i * 22, y: 150 };
    if (c === 'J6') return { x: 489 + i * 22, y: 150 };
    if (c === 'J1') return { x: i === 0 ? 610 : 634, y: 480 };
    const m = Number(c.slice(1));
    return { x: [482, 362, 242, 122][m - 1]! + 12 + i * 23.5, y: 480 };
  };
  const tip = tipPin === null ? null : tipAt(tipPin.ref);
  return h(
    'svg',
    { class: 'board-svg', viewBox: '0 0 700 620', role: 'group', 'aria-label': 'TinyG v8 board drawing. Choose any terminal or pin to see its name, what it does and its current setting.' },
    h('rect', { x: 35, y: 30, width: 630, height: 560, rx: 15, class: 'board-base' }),
    ...[[51, 46], [649, 46], [51, 574], [649, 574]].map(([cx, cy]) => h('circle', { cx, cy, r: 7, class: 'board-hole', key: `${cx}-${cy}` })),
    h('path', { d: 'M125 490V340l25-30V140M185 490V340l25-30V140M245 490V340l25-30V140M305 490V340l25-30V140M365 490V340l25-30V140M425 490V340l25-30V140M485 490V340l25-30V140M545 490V340l25-30V140', class: 'board-trace' }),
    h('text', { x: 310, y: 330, class: 'board-title' }, 'TinyG'),
    h('text', { x: 405, y: 330, class: 'board-print' }, 'v8'),
    h('rect', { x: 270, y: 180, width: 85, height: 85, rx: 3, class: 'chip' }),
    h('text', { x: 282, y: 228, class: 'board-print' }, 'ATxmega'),
    h('rect', { x: 25, y: 125, width: 85, height: 62, rx: 3, class: 'usb' }),
    h('rect', { x: 25, y: 136, width: 27, height: 39, class: 'usb-in' }),
    h('text', { x: 62, y: 161, class: 'board-print dark' }, 'USB'),
    h('rect', { x: 596, y: 504, width: 54, height: 59, class: 'connector' }),
    h('text', { x: 596, y: 581, class: 'board-print' }, 'J1 POWER'),
    ...(power.length === 2 ? [target({ pin: power[0] as PinInfo, ref: (power[0] as PinInfo).ref, cx: 610, cy: 519, w: 26, hgt: 26, r: 7 }), target({ pin: power[1] as PinInfo, ref: (power[1] as PinInfo).ref, cx: 634, cy: 542, w: 26, hgt: 26, r: 7 })] : []),
    ...header('J8', 145),
    ...header('J7', 310),
    ...header('J6', 475),
    ...motor(4, 122),
    ...motor(3, 242),
    ...motor(2, 362),
    ...motor(1, 482),
    h('rect', { x: 505, y: 183, width: 54, height: 39, class: 'chip' }),
    h('text', { x: 511, y: 245, class: 'board-print' }, 'ICSP'),
    h('circle', { cx: 610, cy: 178, r: 12, class: 'pot' }),
    h('text', { x: 590, y: 205, class: 'board-print' }, 'RESET'),
    h('rect', { x: 611, y: 405, width: 34, height: 53, class: 'connector' }),
    h('text', { x: 613, y: 474, class: 'board-print' }, 'FAN'),
    h('g', { class: 'leds' }, ...[238, 258, 278, 337, 357].map((y) => h('rect', { x: 66, y, width: 9, height: 5, key: String(y) }))),
    ...[['PWR', 244], ['TX', 264], ['RX', 284], ['SPIN', 343], ['COOL', 363]].map(([t, y]) => h('text', { x: 82, y, class: 'board-print', key: String(t) }, t)),
    tip === null || tipPin === null
      ? null
      : h(
        'g',
        { class: 'pin-tip', 'aria-hidden': 'true', transform: `translate(${Math.min(Math.max(tip.x, 120), 580)} ${tip.y})` },
        h('rect', { x: -110, y: -16, width: 220, height: 34, rx: 6 }),
        h('text', { x: 0, y: -1, 'text-anchor': 'middle', class: 'tip-a' }, `${tipPin.ref} · ${tipPin.label}`),
        h('text', { x: 0, y: 12, 'text-anchor': 'middle', class: 'tip-b' }, tipPin.function),
      ),
  );
}

function motorPins({ settings, target }: { readonly settings: Readonly<Record<string, SettingValue>>; readonly target: PinTarget }) {
  return (n: number, x: number): ComponentChild[] => {
    const pins = connectorPins(`M${n}`);
    const ma = settings[`${n}ma`];
    return [
      h('text', { key: `m${n}-t`, x: x + 2, y: 382, class: 'board-print' }, `MOTOR ${n}`),
      h('rect', { key: `m${n}-c`, x: x + 19, y: 398, width: 48, height: 47, class: 'chip' }),
      h('circle', { key: `m${n}-p`, cx: x + 58, cy: 473, r: 15, class: 'pot' }),
      h('circle', { key: `m${n}-pi`, cx: x + 58, cy: 473, r: 10, class: 'pot-in' }),
      h('rect', { key: `m${n}-b`, x, y: 507, width: 95, height: 35, class: 'connector' }),
      ...pins.map((p, i) => target({ pin: p, ref: p.ref, cx: x + 12 + i * 23.5, cy: 524, w: 23.5, hgt: 56, r: 7 })),
      h('text', { key: `m${n}-a`, x, y: 566, class: 'board-print' }, typeof ma === 'number' ? `${AXIS_NAMES[ma] ?? `axis ${ma}`} AXIS` : 'AXIS ?'),
    ];
  };
}

function headerPins({ target }: { readonly target: PinTarget }) {
  return (id: string, x: number): ComponentChild[] => {
    const pins = connectorPins(id);
    return [
      h('rect', { key: `${id}-body`, x, y: 58, width: 138, height: 35, class: 'connector' }),
      ...pins.map((p, i) => target({ pin: p, ref: p.ref, cx: x + 14 + i * 22, cy: 75, w: 22, hgt: 62, r: 6.5, extra: [h('text', { x: x + 14 + i * 22, y: 104, class: 'pin-print', 'text-anchor': 'middle' }, p.label.replace('3.3v', '3V3').replace('Spindle', 'Spin').replace('SpinDir', 'Dir').replace('SpinPWM', 'PWM').replace('Coolant', 'Cool').toUpperCase())] })),
      h('text', { key: `${id}-label`, x, y: 124, class: 'board-print' }, connectorLabel(id).toUpperCase()),
    ];
  };
}

function pinTarget({ selected, onSelect, setHover }: { readonly selected: string | null; readonly onSelect: (ref: string) => void; readonly setHover: Dispatch<StateUpdater<string | null>> }) {
  return ({ pin, ref, cx, cy, w, hgt, r, extra = [] }: { readonly pin: PinInfo | null; readonly ref: string; readonly cx: number; readonly cy: number; readonly w: number; readonly hgt: number; readonly r: number; readonly extra?: ComponentChild[]; }): ComponentChild => {
    const label = pin === null ? ref : `${pin.ref} ${pin.label}: ${pin.function}`;
    return h(
      'g',
      {
        key: ref,
        class: `pin-target${selected === ref ? ' selected' : ''}${pin?.role === 'motor' && selected !== null && selected.startsWith(`${pin.connector}.`) ? ' sibling' : ''}`,
        role: 'button',
        tabindex: 0,
        'aria-label': label,
        'aria-pressed': selected === ref ? 'true' : 'false',
        'data-pin': ref,
        onClick: () => onSelect(ref),
        onMouseEnter: () => setHover(ref),
        onMouseLeave: () => setHover((x) => (x === ref ? null : x)),
        onFocus: () => setHover(ref),
        onBlur: () => setHover((x) => (x === ref ? null : x)),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(ref);
          }
        },
      },
      h('title', null, label),
      h('rect', { x: cx - w / 2, y: cy - hgt / 2, width: w, height: hgt, rx: 4, class: 'hit' }),
      h('circle', { cx, cy, r, class: 'contact' }),
      h('path', { d: `m${cx - r / 2} ${cy}h${r}`, class: 'contact-slot' }),
      h('circle', { cx, cy, r: r + 3.5, class: 'ring' }),
      ...extra
    );
  };
}

type PinTarget = ReturnType<typeof pinTarget>;
