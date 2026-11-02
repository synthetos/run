/**
 * Building blocks shared by the TinyG read allowlists (ROADMAP P0-09; PN §12.3).
 *
 * Everything here is an explicit token list or an explicit deny reason. The
 * helpers only spell out products of explicit lists (`cross(['x'], ['vm'])`
 * is `['xvm']`); nothing is derived from the vendored tables.
 *
 * Citations: EN = TinyG edge-next @ 6ec70652, TG = master @ d0418390,
 * S449 = edge-0.97 @ c5024186; paths under firmware/tinyg/.
 */

/** Every combination of a prefix and a suffix, prefix-major. */
export function cross(prefixes: readonly string[], suffixes: readonly string[]): string[] {
  return prefixes.flatMap((p) => suffixes.map((s) => `${p}${s}`));
}

export const MOTORS = ['1', '2', '3', '4'] as const;
export const MOTOR_KEYS = ['ma', 'mi', 'pm', 'po', 'sa', 'tr'] as const;
export const AXES = ['x', 'y', 'z', 'a', 'b', 'c'] as const;
/** Linear axes X, Y, Z: every axis setting including the switches. */
export const LINEAR_AXIS_KEYS = ['am', 'fr', 'jd', 'jh', 'jm', 'lb', 'lv', 'sn', 'sv', 'sx', 'tm', 'tn', 'vm', 'zb'] as const;
/** The A axis: the linear set plus the rotary radius. */
export const A_AXIS_KEYS = [...LINEAR_AXIS_KEYS, 'ra'] as const;
/** B and C: no switches, no homing settings. */
export const BC_AXIS_KEYS = ['am', 'fr', 'jd', 'jm', 'ra', 'tm', 'tn', 'vm'] as const;
export const OFFSET_GROUPS = ['g54', 'g55', 'g56', 'g57', 'g58', 'g59', 'g92', 'g28', 'g30'] as const;
/** Homing state per axis plus `home`, the overall homing state (a pure getter; only a SET runs homing). */
export const HOMING_KEYS = ['a', 'b', 'c', 'e', 'x', 'y', 'z'] as const;
/** Last probe result per axis plus `prbe`, the probe-success flag. */
export const PROBE_RESULT_KEYS = ['a', 'b', 'c', 'e', 'x', 'y', 'z'] as const;
export const PWM_KEYS = ['cph', 'cpl', 'csh', 'csl', 'frq', 'pof', 'wph', 'wpl', 'wsh', 'wsl'] as const;
export const USER_DATA_GROUPS = ['uda', 'udb', 'udc', 'udd'] as const;
/** Read-only planner and stepper diagnostics, per motor or per axis (`set_nul`, `get_flt`). */
export const MOTOR_DIAGNOSTIC_GROUPS = ['_cs', '_es', '_fe', '_ps', '_ts', '_xs'] as const;
export const AXIS_DIAGNOSTIC_GROUPS = ['_te', '_tr'] as const;
/** Status-report field selectors se00..se29: readable, never written (PN §12.4, E140). */
export const SR_FIELD_TOKENS = Array.from({ length: 30 }, (_, i) => `se${String(i).padStart(2, '0')}`);

/** Machine-model state every TinyG build reports through pure getters. */
export const LIVE_STATE_TOKENS = [
  'coor',
  'cycs',
  'dist',
  'feed',
  'frmo',
  'hold',
  'line',
  'macs',
  'momo',
  'mots',
  'n',
  'path',
  'plan',
  'qr',
  'rx',
  'sr',
  'stat',
  'tool',
  'unit',
  'vel',
] as const;

/** Single-key reads under the groups above, common to the three TinyG tables. */
export function commonGroupedTokens(): string[] {
  return [
    ...cross(MOTORS, MOTOR_KEYS),
    ...cross(['x', 'y', 'z'], LINEAR_AXIS_KEYS),
    ...cross(['a'], A_AXIS_KEYS),
    ...cross(['b', 'c'], BC_AXIS_KEYS),
    ...cross(OFFSET_GROUPS, AXES),
    ...cross(['mpo', 'pos', 'ofs'], AXES),
    ...cross(['hom'], HOMING_KEYS),
    ...cross(['prb'], PROBE_RESULT_KEYS),
    ...cross(['p1'], PWM_KEYS),
    ...cross(['jid'], ['a', 'b', 'c', 'd']),
    ...cross(USER_DATA_GROUPS, ['0', '1', '2', '3']),
    ...cross(MOTOR_DIAGNOSTIC_GROUPS, MOTORS),
    ...cross(AXIS_DIAGNOSTIC_GROUPS, AXES),
  ];
}

/** Group names common to the three TinyG tables (a group GET reads every member). */
export const COMMON_GROUPS = [
  ...MOTORS,
  ...AXES,
  'sys',
  ...OFFSET_GROUPS,
  'mpo',
  'pos',
  'ofs',
  'hom',
  'prb',
  'pwr',
  'p1',
  'jid',
  ...USER_DATA_GROUPS,
  ...MOTOR_DIAGNOSTIC_GROUPS,
  ...AXIS_DIAGNOSTIC_GROUPS,
] as const;

/** `sys` group members present on all three TinyG builds. */
export const COMMON_SYS_TOKENS = [
  'baud',
  'ct',
  'ec',
  'ee',
  'ej',
  'ex',
  'fb',
  'fv',
  'gco',
  'gdi',
  'gpa',
  'gpl',
  'gun',
  'hp',
  'hv',
  'id',
  'ja',
  'js',
  'jv',
  'mt',
  'qv',
  'si',
  'sl',
  'st',
  'sv',
  'tv',
] as const;

/**
 * The deny entries every TinyG dialect carries, whether or not its table has
 * the token (a build that adds one must still never be read): the EN-HIL deny
 * list (PN §12.3) plus `adc3`. ROADMAP P0-09: `adc3`, `md` and `me` are
 * denied in every dialect.
 */
export const REQUIRED_DENY: Readonly<Record<string, string>> = Object.freeze({
  alarm: 'GET raises an alarm (E138; EN config_app.c:464-505)',
  panic: 'GET raises a panic (E138; EN config_app.c:464-505)',
  shutd: 'GET raises a shutdown (E138; EN config_app.c:464-505)',
  me: 'GET energizes every motor (EN stepper.c:1413-1436); commissioning only, never a read',
  md: 'GET de-energizes every motor: holding torque drops and Z can fall (EN config_app.c:465; TG config_app.c:469)',
  er: 'GET fakes an exception report (EN report.c:162-165)',
  boot: 'not a value: any SET enters the bootloader (AUD E138); sent only by the flasher',
  defa: 'not a value: a SET restores factory defaults',
  test: 'not a value: a SET runs the board\'s built-in test',
  qf: 'not a value: a SET flushes the planner queue',
  clear: 'GET clears an alarm (EN config_app.c:492); sent only by the C13 "clear alarm" intent, never as a read',
  clr: 'GET clears an alarm (EN config_app.c:493, synonym of clear); never sent',
  help: 'prints text-mode help, not JSON (EN-HIL deny list)',
  h: 'prints text-mode help, not JSON (EN-HIL deny list)',
  adc3: 'GET starts an ADC conversion on the J13/SPI2 pin (EN config_app.c:661); the probe never reads it (PN §2.3)',
});

/** Deny entries for tokens every TinyG table has that are not readings of anything. */
export const COMMON_DENY: Readonly<Record<string, string>> = Object.freeze({
  gc: 'the G-code channel, not a value: G-code is sent as plain lines through the sanitiser',
  msg: 'message plumbing, not a value',
  qi: 'GET resets the queue-report counter it returns (EN report.c:793-799), corrupting queue reports',
  qo: 'GET resets the queue-report counter it returns (EN report.c:801-807), corrupting queue reports',
  $: 'uber-group: answers with several responses to one request (EN config_app.c:904-917), breaking one-request/one-response accounting; read the groups one at a time',
  m: 'uber-group of the motor groups (EN config_app.c:889-892): several responses to one request; read 1..4 one at a time',
  q: 'uber-group of the axis groups (EN config_app.c:894-897): several responses to one request; read x..c one at a time',
  o: 'uber-group of the offset groups (EN config_app.c:899-902): several responses to one request; read g54..g30 one at a time',
});

export const JOG_PREFIX_DENY: Readonly<Record<string, string>> = Object.freeze({
  jog: 'jog commands (`jog`, `jogx`, `joga`...): a SET starts motion (EN-HIL deny list `jog*`); never sent',
});
