/**
 * What each cfgArray get and set function does on the board (ROADMAP P0-09;
 * PN §12.3, E138).
 *
 * A TinyG GET runs the row's get function and a SET runs its set function.
 * Some get functions act (raise an alarm, energize or de-energize motors,
 * clear an alarm, reset a counter), so the read allowlist cannot be decided
 * by token name alone. These two maps classify every function that appears in
 * a vendored table, and the allowlist tests hold the allowlists to them:
 * - an allowlisted token's getter must be `value`, `stub` or `group` (and a
 *   group only when every member is allowlisted too, because a group GET runs
 *   every member's getter: EN config.c:534-562);
 * - an overlay key's setter must be `value`.
 *
 * A function that is not in these maps fails the tests, so a firmware bump
 * that adds one cannot pass CI until somebody has read it and classified it.
 * Changing a class needs the owner's review (CODEOWNERS).
 *
 * Citations are to EN (`edge-next` @ 97321391) unless tagged TG (master @
 * d0418390) or S449 (edge-0.97 @ c5024186).
 */

export type GetterClass =
  /** Returns a value and changes nothing. */
  | 'value'
  /** A reserved setting that answers status 17 (stubbed) and changes nothing. */
  | 'stub'
  /** Returns nothing (null) or a constant; not a reading of anything. */
  | 'constant'
  /** A group: runs every member's getter (config.c:534-562). */
  | 'group'
  /** An uber-group: prints several groups as several responses to one request (config_app.c:847-893). */
  | 'uberGroup'
  /** Prints help or a debug dump as text. */
  | 'text'
  /** Acts on the board: never a read (E138). */
  | 'sideEffect';

export const GETTER_CLASS: Readonly<Record<string, GetterClass>> = Object.freeze({
  // Plain value getters (config.c, canonical_machine.c:2410-2420, report.c).
  get_data: 'value',
  get_flt: 'value',
  get_int: 'value',
  get_u16: 'value',
  get_u32: 'value',
  get_ui8: 'value',
  cm_get_admo: 'value',
  cm_get_am: 'value',
  cm_get_coor: 'value',
  cm_get_cycs: 'value',
  cm_get_dist: 'value',
  cm_get_feed: 'value',
  cm_get_frmo: 'value',
  cm_get_hold: 'value',
  cm_get_home: 'value',
  cm_get_line: 'value',
  cm_get_macs: 'value',
  /** TG only: the model line number. */
  cm_get_mline: 'value',
  cm_get_momo: 'value',
  cm_get_mots: 'value',
  cm_get_mpo: 'value',
  cm_get_ofs: 'value',
  cm_get_path: 'value',
  cm_get_plan: 'value',
  cm_get_pos: 'value',
  cm_get_stat: 'value',
  cm_get_toolv: 'value',
  cm_get_unit: 'value',
  cm_get_vel: 'value',
  /** Board id string (hardware.c:206-213). */
  hw_get_id: 'value',
  /** Stack watermark (stack_report.c:47-60): updates only its own watermark. */
  hw_get_fstk: 'value',
  /** Motor enabled flag (stepper.c:1384-1393). */
  st_get_pwr: 'value',
  /** RX bytes or line buffers free (config_app.c:969-985). */
  get_rx: 'value',
  /** Planner buffers free (report.c:786-791). */
  qr_get: 'value',
  /** A status report (report.c:611-614, :621-624). */
  sr_get: 'value',
  srs_get: 'value',
  /** One status-report field selector (report.c:631-637). */
  sr_get_se: 'value',

  _reserved_hold_setting: 'stub',

  get_nul: 'constant',
  /** Retired settings answer 0 (config_app.c:87-94). */
  get_legacy_zero: 'constant',
  /** TG only: the G-code channel; a GET returns nothing useful. */
  gc_get_gc: 'constant',

  get_grp: 'group',

  _do_all: 'uberGroup',
  _do_axes: 'uberGroup',
  _do_motors: 'uberGroup',
  _do_offsets: 'uberGroup',

  help_boot: 'text',
  /** TG only. */
  help_boot_loader: 'text',
  help_config: 'text',
  help_defa: 'text',
  help_test: 'text',
  /** TG only: "dump active model" printf (TG canonical_machine.c:1802-1812). */
  cm_dam: 'text',

  /** GET raises an alarm (E138; config_app.c:463-504). */
  cm_alrm: 'sideEffect',
  cm_pnic: 'sideEffect',
  cm_shutd: 'sideEffect',
  /** GET clears an alarm (config_app.c:491-492; TG cm_clear, canonical_machine.c:590-598). */
  cm_clr: 'sideEffect',
  cm_clear: 'sideEffect',
  /** GET of `me` energizes, of `md` de-energizes every motor (stepper.c:1413-1436): Z can fall. */
  st_set_me: 'sideEffect',
  st_set_md: 'sideEffect',
  /** GET fakes an exception report (report.c:162-165). */
  rpt_er: 'sideEffect',
  /** GET starts an ADC conversion on the J13/SPI2 pin (config_app.c:660). */
  hw_get_adc3: 'sideEffect',
  /** GET resets the queue-report counter it returns (report.c:793-807). */
  qi_get: 'sideEffect',
  qo_get: 'sideEffect',
});

export type SetterClass =
  /** Read-only: a SET is refused. */
  | 'readOnly'
  /** Stores a value (a setting or a piece of state). */
  | 'value'
  /** Runs an action (homing, jogging, alarm, bootloader, defaults, tests, G-code). */
  | 'command'
  /** Configures status reports (sr/srs). */
  | 'reportConfig'
  /** Protocol plumbing (`msg`, `txt`, `tid`, `set`). */
  | 'plumbing'
  | 'stub'
  /** A retired setting accepted only for backup compatibility (config_app.c:87-110). */
  | 'legacy'
  | 'group';

export const SETTER_CLASS: Readonly<Record<string, SetterClass>> = Object.freeze({
  set_nul: 'readOnly',

  cm_set_am: 'value',
  cm_set_xjh: 'value',
  cm_set_xjm: 'value',
  hw_set_hv: 'value',
  json_set_jv: 'value',
  set_01: 'value',
  set_012: 'value',
  set_0123: 'value',
  set_baud: 'value',
  set_data: 'value',
  set_ec: 'value',
  set_ee: 'value',
  set_ex: 'value',
  set_flt: 'value',
  set_flu: 'value',
  set_gco: 'value',
  set_int: 'value',
  set_ma: 'value',
  set_u16: 'value',
  set_u32: 'value',
  set_ui8: 'value',
  spindle_set_polarity: 'value',
  sr_set_se: 'value',
  sr_set_si: 'value',
  st_set_mi: 'value',
  st_set_mt: 'value',
  st_set_pm: 'value',
  st_set_sa: 'value',
  st_set_tr: 'value',
  sw_set_prbp: 'value',
  sw_set_st: 'value',
  sw_set_sw: 'value',

  cm_alrm: 'command',
  cm_clear: 'command',
  cm_clr: 'command',
  cm_dam: 'command',
  cm_pnic: 'command',
  cm_run_home: 'command',
  cm_run_joga: 'command',
  cm_run_jogx: 'command',
  cm_run_jogy: 'command',
  cm_run_jogz: 'command',
  cm_run_qf: 'command',
  cm_shutd: 'command',
  gc_run_gc: 'command',
  help_config: 'command',
  hw_run_boot: 'command',
  run_test: 'command',
  set_defaults: 'command',
  st_set_md: 'command',
  st_set_me: 'command',

  sr_set: 'reportConfig',
  srs_set: 'reportConfig',

  set_not: 'plumbing',
  set_str: 'plumbing',

  _reserved_hold_setting: 'stub',

  set_legacy_arc_length: 'legacy',
  set_legacy_zero: 'legacy',

  set_grp: 'group',
});

export function getterClass(getter: string): GetterClass | undefined {
  return Object.hasOwn(GETTER_CLASS, getter) ? GETTER_CLASS[getter] : undefined;
}

export function setterClass(setter: string): SetterClass | undefined {
  return Object.hasOwn(SETTER_CLASS, setter) ? SETTER_CLASS[setter] : undefined;
}
