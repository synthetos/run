/**
 * Board definition renderer of the generator (ROADMAP TB-05a).
 *
 * Turns the vendored TinyG board facts (tinyg.ts) and the hand-written
 * overlays into one definition per hardware version:
 * packages/schema/boards/tinyg/tinyg-v<hv>@<hv>.json, plus the module that
 * imports them all (packages/schema/src/generated/boards.ts).
 *
 * Firmware facts come only from the facts file. An overlay adds what firmware
 * does not know (connectors, ratings, driver, USB identity) and may replace
 * only the facts it is allowed to: it never changes a pin map, an output or a
 * count. Every rendered definition is validated with parseBoardDefinition
 * (schema plus pin consistency), so an overlay pin that names a signal the
 * generated pin map does not have stops the generator.
 */
import { parseBoardDefinition } from '../../../../packages/schema/src/boards.ts';
import type { BoardConnector, BoardDefinition, BoardPin, BoardRating, Fact } from '../../../../packages/schema/src/boards.ts';
import type { TinyGFacts, XmegaPort } from './tinyg.ts';
import { TINYG_FACTS_FORMAT } from './tinyg.ts';

export const OVERLAY_FORMAT = 'synthetos-board-overlay@1';

export interface BoardOverlay {
  readonly format: typeof OVERLAY_FORMAT;
  /** The definition id the overlay applies to, e.g. tinyg-v8@8. */
  readonly board: string;
  readonly note: string;
  readonly motors?: { readonly driver?: Fact<string>; readonly currentSetting?: Fact<'board' | 'firmware' | 'unknown'> };
  readonly usb?: BoardDefinition['usb'];
  readonly connectors?: readonly BoardConnector[];
  readonly ratings?: readonly BoardRating[];
}

const OVERLAY_KEYS = new Set(['format', 'board', 'note', 'motors', 'usb', 'connectors', 'ratings']);
const OVERLAY_MOTOR_KEYS = new Set(['driver', 'currentSetting']);

/** Check an overlay's shape before it is merged (the merged result is schema-checked too). */
export function parseOverlay(json: unknown, file: string): BoardOverlay {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error(`gen-boards: ${file} is not an object`);
  const o = json as Record<string, unknown>;
  for (const key of Object.keys(o)) if (!OVERLAY_KEYS.has(key)) throw new Error(`gen-boards: ${file}: overlays may not set "${key}"`);
  if (o['format'] !== OVERLAY_FORMAT) throw new Error(`gen-boards: ${file}: format must be ${OVERLAY_FORMAT}`);
  if (typeof o['board'] !== 'string' || typeof o['note'] !== 'string') throw new Error(`gen-boards: ${file}: board and note are required strings`);
  if (`${o['board']}.json` !== file.split('/').pop()) throw new Error(`gen-boards: ${file}: the file must be named after its board (${o['board']}.json)`);
  const motors = o['motors'];
  if (motors !== undefined) {
    if (typeof motors !== 'object' || motors === null) throw new Error(`gen-boards: ${file}: motors must be an object`);
    for (const key of Object.keys(motors)) if (!OVERLAY_MOTOR_KEYS.has(key)) throw new Error(`gen-boards: ${file}: overlays may not set motors.${key}`);
  }
  return json as BoardOverlay;
}

const pinName = (port: XmegaPort, bit: number): string => `P${port}${bit}`;

/** The firmware-only definition of one TinyG hardware version. */
export function tinygBoard(facts: TinyGFacts, hv: number): BoardDefinition {
  if (facts.format !== TINYG_FACTS_FORMAT) throw new Error(`gen-boards: facts format must be ${TINYG_FACTS_FORMAT}`);
  const revision = facts.revisions.find((r) => r.value === hv);
  if (revision === undefined) throw new Error(`gen-boards: hv ${hv} is not a TinyG revision the firmware recognises`);
  const fact = <T>(c: { value: T; src: string }): Fact<T> => ({ value: c.value, src: c.src, verified: 'source' });
  const bits = facts.portBits.value;
  const v7 = hv > facts.outputMapThreshold.value;
  const outPorts = v7 ? facts.outputPortsV7 : facts.outputPortsV6;
  const outSrc = `${facts.outputMapThreshold.src} (hv ${hv} uses the ${v7 ? 'v7' : 'v6'} output mapping); ${outPorts.src}; ${facts.maskToOutPort.src}`;

  const pins: BoardPin[] = [];
  facts.motorPorts.value.forEach((port, i) => {
    const signals = [
      ['step', bits.step],
      ['dir', bits.dir],
      ['enable', bits.enable],
      ['ms0', bits.ms0],
      ['ms1', bits.ms1],
    ] as const;
    for (const [name, bit] of signals) {
      pins.push({ signal: `motor${i + 1}.${name}`, mcu: pinName(port, bit), src: `${facts.motorPorts.src}; ${facts.portBits.src}`, verified: 'source' });
    }
  });
  for (const fn of facts.switches.value) {
    const m = /^limit-(min|max)-([xyza])$/.exec(fn);
    if (m === null) throw new Error(`gen-boards: unexpected switch ${fn}`);
    const port = facts.switchPorts.value[m[2] as 'x' | 'y' | 'z' | 'a'];
    pins.push({
      signal: `in.${fn}`,
      mcu: pinName(port, m[1] === 'min' ? bits.swMin : bits.swMax),
      src: `${facts.switchPorts.src}; ${facts.portBits.src}; ${facts.switches.src}`,
      verified: 'source',
    });
  }
  const ids = ['spindleEnable', 'spindleDirection', 'spindlePwm', 'coolant'] as const;
  const gpioPin = Object.fromEntries(
    ids.map((id) => {
      const mask = facts.outputMasks.value[id];
      const index = facts.maskToOutPort.value[`0x${mask.toString(16).padStart(2, '0')}`];
      const port = index === undefined ? undefined : outPorts.value[index];
      if (port === undefined) throw new Error(`gen-boards: output ${id} has no port`);
      return [id, pinName(port, bits.gpio1Out)];
    }),
  ) as Record<(typeof ids)[number], string>;
  // The PWM waveform comes out on the timer's compare pin, whatever the GPIO mapping says. Where the
  // two disagree, neither the PWM output nor the output whose GPIO pin the timer drives is trusted.
  const timer = facts.spindlePwmTimer.value;
  const pwmPin = pinName(timer.port, timer.pin);
  const timerSrc = `${facts.spindlePwmTimer.src} (${timer.timer} compare ${timer.channel} drives ${pwmPin})`;
  const pwmSplit = gpioPin.spindlePwm !== pwmPin;
  const conflict = (id: (typeof ids)[number]): string | undefined => {
    if (!pwmSplit) return undefined;
    if (id === 'spindlePwm') return `Conflicting: the GPIO bit is on ${gpioPin.spindlePwm}, the PWM waveform on ${pwmPin} (${timer.timer} OC${timer.timer.slice(-1)}${timer.channel}). Do not wire the speed signal from ${gpioPin.spindlePwm}.`;
    if (gpioPin[id] === pwmPin) return `Conflicting: ${pwmPin} is also the spindle PWM timer output, which overrides on/off writes.`;
    return undefined;
  };
  const outputs = ids.map((id) => {
    const why = conflict(id);
    const base = `${facts.outputMasks.src}; ${outSrc}; ${facts.portBits.src}`;
    if (why === undefined) pins.push({ signal: `out.${id}`, mcu: gpioPin[id], src: base, verified: 'source' });
    // The PWM pin is the timer's; the GPIO pin is named only in the output's note.
    else if (id === 'spindlePwm') pins.push({ signal: 'out.spindlePwm', mcu: pwmPin, src: `${timerSrc}; GPIO bit on ${gpioPin[id]} (${facts.outputMasks.src}): conflicting`, verified: 'unverified' });
    else pins.push({ signal: `out.${id}`, mcu: gpioPin[id], src: `${facts.outputMasks.src}; ${outPorts.src}; ${timerSrc}: conflicting`, verified: 'unverified' });
    const notes = [...(id === 'coolant' ? ['Mist and flood share one output.'] : []), ...(why === undefined ? [] : [why])];
    const src = id === 'spindleEnable' || id === 'spindleDirection' ? `${facts.outputMasks.src}; ${facts.polarityTokens.src}` : facts.outputMasks.src;
    return {
      id,
      ...(id === 'spindleEnable' ? { polarityToken: facts.polarityTokens.value.spindleEnable } : {}),
      ...(id === 'spindleDirection' ? { polarityToken: facts.polarityTokens.value.spindleDirection } : {}),
      ...(notes.length === 0 ? {} : { note: notes.join(' ') }),
      src: why === undefined ? src : `${src}; ${timerSrc}`,
      verified: why === undefined ? ('source' as const) : ('unverified' as const),
    };
  });

  return {
    format: 'synthetos-board@1',
    id: `tinyg-v${hv}@${hv}`,
    family: 'tinyg',
    name: `TinyG v${hv}`,
    match: { hp: facts.platform.value, hv: [hv] },
    source: {
      kind: 'generated',
      firmware: facts.firmware,
      note: `Generated by pnpm gen:boards from vendor/tinyg-board-facts (TinyG ${facts.firmware}, ${revision.src}). Do not edit: change the overlay or regenerate.`,
    },
    motors: {
      count: fact(facts.motors),
      microsteps: fact(facts.microsteps),
      currentSetting: { value: 'board', src: `No motor-current token in ${facts.firmware.split('@')[0] ?? ''} config_app.c; current is set on the board`, verified: 'unverified' },
    },
    inputs: { count: { value: facts.switches.value.length, src: facts.switches.src, verified: 'source' }, functions: fact(facts.switches), typeSetting: fact(facts.switchTypeToken) },
    outputs,
    adc: [],
    usb: [],
    flasher: { value: 'xboot-avr109', src: facts.bootloader.src, verified: 'source' },
    defaults: fact(facts.defaults),
    buildFlags: [],
    pins,
  };
}

/** Merge an overlay into a generated definition. */
export function applyOverlay(board: BoardDefinition, overlay: BoardOverlay | undefined): BoardDefinition {
  if (overlay === undefined) return board;
  if (overlay.board !== board.id) throw new Error(`gen-boards: overlay for ${overlay.board} applied to ${board.id}`);
  return {
    ...board,
    source: { ...board.source, note: `${board.source.note} Overlay: ${overlay.note}` },
    motors: { ...board.motors, ...(overlay.motors ?? {}) },
    ...(overlay.usb === undefined ? {} : { usb: overlay.usb }),
    ...(overlay.connectors === undefined ? {} : { connectors: overlay.connectors }),
    ...(overlay.ratings === undefined ? {} : { ratings: overlay.ratings }),
  };
}

/** Stable text of a definition file. Refuses a definition the schema or the pin check rejects. */
export function renderBoard(board: BoardDefinition): string {
  const parsed = parseBoardDefinition(board);
  if (!parsed.ok) throw new Error(`gen-boards: ${board.id} is invalid: ${parsed.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  return `${JSON.stringify(board, null, 2)}\n`;
}

/** The module that imports every generated definition. */
export function renderIndex(paths: readonly string[]): string {
  const sorted = [...paths].sort();
  const lines = [
    '// Generated by pnpm gen:boards (tools/gates/src/boards). Do not edit.',
    ...sorted.map((p, i) => `import b${i} from '../../boards/${p}' with { type: 'json' };`),
    '',
    '/** Every generated board definition, unparsed (boards.ts validates them). */',
    `export const GENERATED_BOARDS: readonly unknown[] = [${sorted.map((_, i) => `b${i}`).join(', ')}];`,
    '',
  ];
  return lines.join('\n');
}

/**
 * Render every TinyG definition. Returns a map from the path under
 * packages/schema/ to the file text. Every overlay must apply to a rendered
 * board.
 */
export function renderTinyGBoards(facts: TinyGFacts, overlays: readonly BoardOverlay[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const { value: hv } of facts.revisions) {
    const generated = tinygBoard(facts, hv);
    const overlay = overlays.find((o) => o.board === generated.id);
    if (overlay !== undefined) used.add(overlay.board);
    out.set(`boards/tinyg/${generated.id}.json`, renderBoard(applyOverlay(generated, overlay)));
  }
  for (const o of overlays) if (!used.has(o.board)) throw new Error(`gen-boards: overlay ${o.board} matches no generated board`);
  out.set('src/generated/boards.ts', renderIndex([...out.keys()].map((p) => p.replace(/^boards\//, ''))));
  return out;
}
