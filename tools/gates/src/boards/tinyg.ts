/**
 * TinyG reader of the board definition generator (ROADMAP TB-05a).
 *
 * Reads the pinned TinyG edge-next sources and extracts the board facts the
 * firmware knows: the hardware platform (`hp`), every hardware version (`hv`)
 * the build accepts, the motor, switch and output port bindings per version,
 * the microstep values, the polarity tokens. Every fact carries a file:line
 * citation at the pinned commit.
 *
 * The result is vendored as vendor/tinyg-board-facts/<tag>.json, so CI can
 * regenerate the board definitions without the firmware repository (the same
 * arrangement as vendor/tinyg-hil-tables/). The extractor refuses source it
 * does not understand: every pattern must match exactly as expected, or it
 * throws, so a firmware bump that moves a fact fails loudly instead of
 * producing a wrong board.
 */

export const TINYG_FACTS_FORMAT = 'synthetos-run/tinyg-board-facts@1';

/** The firmware files the extractor reads, relative to the repository root. */
export const TINYG_SOURCE_FILES = [
  'firmware/tinyg/hardware.h',
  'firmware/tinyg/hardware.c',
  'firmware/tinyg/tinyg.h',
  'firmware/tinyg/switch.h',
  'firmware/tinyg/gpio.c',
  'firmware/tinyg/stepper.c',
  'firmware/tinyg/config_app.c',
  'firmware/tinyg/settings.h',
] as const;
export type TinyGSourceFile = (typeof TINYG_SOURCE_FILES)[number];

export interface Cited<T> {
  readonly value: T;
  readonly src: string;
}

export type XmegaPort = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type Axis = 'x' | 'y' | 'z' | 'a';
export type OutputSignal = 'spindleEnable' | 'spindleDirection' | 'spindlePwm' | 'coolant';

export interface TinyGFacts {
  readonly format: typeof TINYG_FACTS_FORMAT;
  /** e.g. EN@ead63997 */
  readonly firmware: string;
  readonly commit: string;
  readonly platform: Cited<number>;
  readonly hvMax: Cited<number>;
  /** Every named TinyG Xmega hardware version up to hvMax. */
  readonly revisions: readonly Cited<number>[];
  /** hv strictly above this uses the v7 output port mapping, otherwise the v6 one. */
  readonly outputMapThreshold: Cited<number>;
  readonly motorPorts: Cited<readonly XmegaPort[]>;
  readonly switchPorts: Cited<Readonly<Record<Axis, XmegaPort>>>;
  /** out_port[0..3] for the v7 (and later) mapping and for the v6 mapping. */
  readonly outputPortsV7: Cited<readonly XmegaPort[]>;
  readonly outputPortsV6: Cited<readonly XmegaPort[]>;
  /** Bit positions on each motor/switch port. */
  readonly portBits: Cited<Readonly<Record<'step' | 'dir' | 'enable' | 'ms0' | 'ms1' | 'gpio1Out' | 'swMin' | 'swMax', number>>>;
  /** GPIO1 output mask of each output signal. */
  readonly outputMasks: Cited<Readonly<Record<OutputSignal, number>>>;
  /** Which out_port index each GPIO1 mask drives (gpio_set_bit_on). */
  readonly maskToOutPort: Cited<Readonly<Record<string, number>>>;
  readonly motors: Cited<number>;
  readonly switches: Cited<readonly string[]>;
  readonly microsteps: Cited<readonly number[]>;
  readonly polarityTokens: Cited<Readonly<Record<'spindleEnable' | 'spindleDirection', string>>>;
  readonly switchTypeToken: Cited<string>;
  readonly bootloader: Cited<true>;
  readonly defaults: Cited<string>;
}

interface Hit {
  readonly match: RegExpMatchArray;
  readonly line: number;
}

const short = (path: TinyGSourceFile): string => path.replace(/^firmware\/tinyg\//, '');

/**
 * Extract the TinyG board facts. `read` returns a file's text at the pinned
 * commit (from `git show <commit>:<path>` or a test's synthetic sources).
 */
export function extractTinyG(read: (path: TinyGSourceFile) => string, tag: string, commit: string): TinyGFacts {
  if (!/^[A-Z0-9]+$/.test(tag)) throw new Error(`gen-boards: bad firmware tag ${tag}`);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`gen-boards: commit must be a full 40-hex sha, got ${commit}`);
  const texts = new Map<TinyGSourceFile, string[]>();
  const lines = (path: TinyGSourceFile): string[] => {
    let l = texts.get(path);
    if (l === undefined) {
      l = read(path).split('\n');
      texts.set(path, l);
    }
    return l;
  };
  const cite = (path: TinyGSourceFile, ...at: number[]): string => {
    const sorted = [...new Set(at)].sort((a, b) => a - b);
    const first = sorted[0] as number;
    const last = sorted[sorted.length - 1] as number;
    return `${tag} ${short(path)}:${first === last ? first : `${first}-${last}`}`;
  };
  /** Every line matching `re`. */
  const all = (path: TinyGSourceFile, re: RegExp): Hit[] => {
    const out: Hit[] = [];
    lines(path).forEach((text, i) => {
      const match = text.match(re);
      if (match !== null) out.push({ match, line: i + 1 });
    });
    return out;
  };
  /** Exactly one line matching `re`, or throw. */
  const one = (path: TinyGSourceFile, re: RegExp): Hit => {
    const hits = all(path, re);
    if (hits.length !== 1) throw new Error(`gen-boards: expected exactly one match of ${re} in ${path}, found ${hits.length}`);
    return hits[0] as Hit;
  };
  const group = (hit: Hit, n: number): string => {
    const g = hit.match[n];
    if (g === undefined) throw new Error(`gen-boards: pattern group ${n} missing`);
    return g;
  };

  // Platform: the TINYG_HARDWARE_PLATFORM constant's position in the hwPlatform enum.
  const platformDef = one('firmware/tinyg/tinyg.h', /^#define\s+TINYG_HARDWARE_PLATFORM\s+(HW_PLATFORM_\w+)/);
  const platformName = group(platformDef, 1);
  const enumEnd = one('firmware/tinyg/hardware.h', /^\}\s*hwPlatform;/);
  const enumStart = all('firmware/tinyg/hardware.h', /^typedef enum \{/)
    .filter((h) => h.line < enumEnd.line)
    .pop();
  if (enumStart === undefined) throw new Error('gen-boards: hwPlatform enum has no start');
  const members = lines('firmware/tinyg/hardware.h')
    .slice(enumStart.line, enumEnd.line - 1)
    .map((text, i) => ({ m: text.match(/^\s*(H[WM]_PLATFORM_\w+)\s*(?:=\s*(\d+))?\s*,?/), line: enumStart.line + 1 + i }))
    .filter((x) => x.m !== null);
  let next = 0;
  let platform: Cited<number> | undefined;
  for (const { m, line } of members) {
    const explicit = (m as RegExpMatchArray)[2];
    const value = explicit === undefined ? next : Number(explicit);
    next = value + 1;
    if ((m as RegExpMatchArray)[1] === platformName) platform = { value, src: cite('firmware/tinyg/hardware.h', line) + `; ${cite('firmware/tinyg/tinyg.h', platformDef.line)}` };
  }
  if (platform === undefined) throw new Error(`gen-boards: ${platformName} is not in the hwPlatform enum`);

  // The highest hv hw_set_hv accepts.
  const maxDef = one('firmware/tinyg/tinyg.h', /^#define\s+TINYG_HARDWARE_VERSION_MAX\s+(\w+)/);
  const versionDef = one('firmware/tinyg/tinyg.h', /^#define\s+TINYG_HARDWARE_VERSION\s+(HW_VERSION_\w+)/);
  if (group(maxDef, 1) !== 'TINYG_HARDWARE_VERSION') throw new Error('gen-boards: TINYG_HARDWARE_VERSION_MAX is not TINYG_HARDWARE_VERSION');
  const rejectAbove = one('firmware/tinyg/hardware.c', /if \(nv->value_flt > TINYG_HARDWARE_VERSION_MAX\)/);
  const xmegaVersions = all('firmware/tinyg/hardware.h', /^#define\s+(HW_VERSION_TINYGV(\d+))\s+(\d+)\s*$/);
  const named = new Map(xmegaVersions.map((h) => [group(h, 1), h]));
  const maxHit = named.get(group(versionDef, 1));
  if (maxHit === undefined) throw new Error(`gen-boards: ${group(versionDef, 1)} is not a numbered TinyG Xmega hardware version`);
  const hvMaxValue = Number(group(maxHit, 3));
  const hvMax: Cited<number> = {
    value: hvMaxValue,
    src: `${cite('firmware/tinyg/tinyg.h', versionDef.line, maxDef.line)}; ${cite('firmware/tinyg/hardware.c', rejectAbove.line)} (hw_set_hv rejects hv above it)`,
  };
  const revisions = xmegaVersions
    .filter((h) => Number(group(h, 2)) === Number(group(h, 3)))
    .filter((h) => Number(group(h, 3)) <= hvMaxValue)
    .map((h) => ({ value: Number(group(h, 3)), src: cite('firmware/tinyg/hardware.h', h.line) }));
  if (revisions.length === 0) throw new Error('gen-boards: no TinyG hardware versions found');

  // Output port mapping switch in _port_bindings.
  const threshold = one('firmware/tinyg/hardware.c', /^\s*if \(hw_version > (\d+(?:\.\d+)?)\) \{/);
  const outputMapThreshold = { value: Number(group(threshold, 1)), src: cite('firmware/tinyg/hardware.c', threshold.line) };

  const portDefs = (prefix: string, keys: readonly string[]): Cited<XmegaPort[]> => {
    const hits = keys.map((k) => one('firmware/tinyg/hardware.h', new RegExp(`^#define\\s+${prefix}${k}\\s+PORT([A-F])\\b`)));
    return { value: hits.map((h) => group(h, 1) as XmegaPort), src: cite('firmware/tinyg/hardware.h', ...hits.map((h) => h.line)) };
  };
  const motorPorts = portDefs('PORT_MOTOR_', ['1', '2', '3', '4']);
  const sw = portDefs('PORT_SWITCH_', ['X', 'Y', 'Z', 'A']);
  const [sx, sy, sz, sa] = sw.value as [XmegaPort, XmegaPort, XmegaPort, XmegaPort];
  const switchPorts = { value: { x: sx, y: sy, z: sz, a: sa }, src: sw.src };
  const outputPortsV7 = portDefs('PORT_OUT_V7_', ['X', 'Y', 'Z', 'A']);
  const outputPortsV6 = portDefs('PORT_OUT_V6_', ['X', 'Y', 'Z', 'A']);
  // _port_bindings binds out_port[i] to PORT_OUT_V7_<axis i> in this order; check it.
  for (const [mapping, axes] of [
    ['V7', ['X', 'Y', 'Z', 'A']],
    ['V6', ['X', 'Y', 'Z', 'A']],
  ] as const) {
    axes.forEach((axis, i) => one('firmware/tinyg/hardware.c', new RegExp(`^\\s*hw\\.out_port\\[${i}\\] = &PORT_OUT_${mapping}_${axis};`)));
  }

  // Port bit positions (cfgPortBits).
  const bitNames = ['STEP_BIT_bp', 'DIRECTION_BIT_bp', 'MOTOR_ENABLE_BIT_bp', 'MICROSTEP_BIT_0_bp', 'MICROSTEP_BIT_1_bp', 'GPIO1_OUT_BIT_bp', 'SW_MIN_BIT_bp', 'SW_MAX_BIT_bp'];
  const bitHits = bitNames.map((n) => one('firmware/tinyg/hardware.h', new RegExp(`^\\s*${n}(?:\\s*=\\s*(\\d+))?\\s*,?\\s*//\\s*bit (\\d)`)));
  const bits = bitHits.map((h, i) => {
    const explicit = h.match[1];
    const commented = Number(group(h, 2));
    if (explicit !== undefined && Number(explicit) !== commented) throw new Error(`gen-boards: ${bitNames[i] ?? ''} value and comment disagree`);
    if (commented !== i) throw new Error(`gen-boards: ${bitNames[i] ?? ''} is not bit ${i}`);
    return commented;
  });
  const [step, dir, enable, ms0, ms1, gpio1Out, swMin, swMax] = bits as [number, number, number, number, number, number, number, number];
  const portBits = { value: { step, dir, enable, ms0, ms1, gpio1Out, swMin, swMax }, src: cite('firmware/tinyg/hardware.h', ...bitHits.map((h) => h.line)) };

  // GPIO1 output masks.
  const maskOf = (name: string): Hit => one('firmware/tinyg/hardware.h', new RegExp(`^#define\\s+${name}\\s+0x([0-9A-Fa-f]{2})\\b`));
  const masks = {
    spindleEnable: maskOf('SPINDLE_BIT'),
    spindleDirection: maskOf('SPINDLE_DIR'),
    spindlePwm: maskOf('SPINDLE_PWM'),
    mist: maskOf('MIST_COOLANT_BIT'),
    flood: maskOf('FLOOD_COOLANT_BIT'),
  };
  if (group(masks.mist, 1) !== group(masks.flood, 1)) throw new Error('gen-boards: mist and flood no longer share one output; the board model needs coolantMist and coolantFlood');
  const hex = (h: Hit): number => Number.parseInt(group(h, 1), 16);
  const outputMasks = {
    value: { spindleEnable: hex(masks.spindleEnable), spindleDirection: hex(masks.spindleDirection), spindlePwm: hex(masks.spindlePwm), coolant: hex(masks.mist) },
    src: cite('firmware/tinyg/hardware.h', ...Object.values(masks).map((h) => h.line)),
  };
  const setOn = one('firmware/tinyg/gpio.c', /^void gpio_set_bit_on\(uint8_t b\)/);
  const maskLines = all('firmware/tinyg/gpio.c', /^\s*if \(b & 0x([0-9A-Fa-f]{2})\) \{ hw\.out_port\[(\d)\]->OUTSET = GPIO1_OUT_BIT_bm; \}/);
  if (maskLines.length !== 4 || maskLines.some((h) => h.line <= setOn.line || h.line > setOn.line + 6)) {
    throw new Error('gen-boards: gpio_set_bit_on does not map four masks to out_port[0..3]');
  }
  const maskToOutPort = {
    value: Object.fromEntries(maskLines.map((h) => [`0x${group(h, 1).toLowerCase()}`, Number(group(h, 2))])),
    src: cite('firmware/tinyg/gpio.c', ...maskLines.map((h) => h.line)),
  };
  for (const m of Object.values(outputMasks.value)) {
    if (maskToOutPort.value[`0x${m.toString(16).padStart(2, '0')}`] === undefined) throw new Error(`gen-boards: mask 0x${m.toString(16)} drives no out_port`);
  }

  const motorsHit = one('firmware/tinyg/tinyg.h', /^#define\s+MOTORS\s+(\d+)\b/);
  const motors = { value: Number(group(motorsHit, 1)), src: cite('firmware/tinyg/tinyg.h', motorsHit.line) };
  if (motors.value !== motorPorts.value.length) throw new Error('gen-boards: MOTORS does not match the PORT_MOTOR_n bindings');

  const swHits = all('firmware/tinyg/switch.h', /^\s*SW_(MIN|MAX)_([XYZABC])\b(?:\s*=\s*0)?\s*,/);
  const numSwitches = one('firmware/tinyg/switch.h', /^\s*NUM_SWITCHES\b/);
  const switches = {
    value: swHits.map((h) => `limit-${group(h, 1).toLowerCase()}-${group(h, 2).toLowerCase()}`),
    src: cite('firmware/tinyg/switch.h', ...swHits.map((h) => h.line), numSwitches.line),
  };
  if (switches.value.length !== 8) throw new Error(`gen-boards: expected 8 switches in swNums, found ${switches.value.length}`);

  const ms = one('firmware/tinyg/stepper.c', /if \(\(mi != (\d+)\) && \(mi != (\d+)\) && \(mi != (\d+)\) && \(mi != (\d+)\)\)/);
  const microsteps = { value: [1, 2, 3, 4].map((n) => Number(group(ms, n))), src: `${cite('firmware/tinyg/stepper.c', ms.line)} (other values warn as non-standard)` };

  const token = (key: string): Hit => one('firmware/tinyg/config_app.c', new RegExp(`\\{\\s*"sys",\\s*"${key}",`));
  const spep = token('spep');
  const spdp = token('spdp');
  const polarityTokens = { value: { spindleEnable: 'spep', spindleDirection: 'spdp' }, src: cite('firmware/tinyg/config_app.c', spep.line, spdp.line) };
  const st = token('st');
  const switchTypeToken = { value: 'st', src: cite('firmware/tinyg/config_app.c', st.line) };

  const boot = one('firmware/tinyg/hardware.c', /^void hw_request_bootloader\(\)/);
  const bootloader = { value: true as const, src: `${cite('firmware/tinyg/hardware.c', boot.line)} (hw_request_bootloader); PROTOCOL_NOTES §13.1 (xboot 1.7, AVR109)` };
  const defaultsHit = one('firmware/tinyg/settings.h', /^#include "(settings\/settings_default\.h)"/);
  const defaults = { value: `firmware/tinyg/${group(defaultsHit, 1)}`, src: cite('firmware/tinyg/settings.h', defaultsHit.line) };

  return {
    format: TINYG_FACTS_FORMAT,
    firmware: `${tag}@${commit.slice(0, 8)}`,
    commit,
    platform,
    hvMax,
    revisions,
    outputMapThreshold,
    motorPorts,
    switchPorts,
    outputPortsV7,
    outputPortsV6,
    portBits,
    outputMasks,
    maskToOutPort,
    motors,
    switches,
    microsteps,
    polarityTokens,
    switchTypeToken,
    bootloader,
    defaults,
  };
}

/** Stable text of the facts file. */
export function renderFacts(facts: TinyGFacts): string {
  return `${JSON.stringify(facts, null, 1)}\n`;
}
