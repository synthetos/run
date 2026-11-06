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
 *   every member's getter: EN config.c:624-652);
 * - an overlay key's setter must be `value`.
 *
 * A function that is not in these maps fails the tests, so a firmware bump
 * that adds one cannot pass CI until somebody has read it and classified it.
 * Changing a class needs the owner's review (CODEOWNERS).
 *
 * Citations are to EN (`edge-next` @ a7489b79) unless tagged TG (master @
 * d0418390) or S449 (edge-0.97 @ c5024186).
 */

export type GetterClass =
  /** Returns a value and changes nothing. */
  | 'value'
  /** A reserved setting that answers status 17 (stubbed) and changes nothing. */
  | 'stub'
  /** Returns nothing (null) or a constant; not a reading of anything. */
  | 'constant'
  /** A group: runs every member's getter (config.c:624-652). */
  | 'group'
  /** An uber-group: prints several groups as several responses to one request (config_app.c:909-937). */
  | 'uberGroup'
  /** Prints help or a debug dump as text. */
  | 'text'
  /** Acts on the board: never a read (E138). */
  | 'sideEffect'
  /**
   * Runtime session state (the rt family): answers only inside a pure
   * `{"rt":...}` envelope and STAT_UNRECOGNIZED_NAME anywhere else
   * (runtime.c:95-105). Changes nothing, but it is not a settings read.
   */
  | 'session';

export const GETTER_CLASS: Readonly<Record<string, GetterClass>> = Object.freeze({
  // Plain value getters (config.c, canonical_machine.c:2565-2575, report.c).
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
  /** Motor enabled flag (stepper.c:1580-1589). */
  st_get_pwr: 'value',
  /** RX bytes or line buffers free (config_app.c:1013-1029). */
  get_rx: 'value',
  /** Planner buffers free (report.c:842-847). */
  qr_get: 'value',
  /** A status report (report.c:654-657, :664-667). */
  sr_get: 'value',
  srs_get: 'value',
  /** One status-report field selector (report.c:674-680). */
  sr_get_se: 'value',
  /**
   * Spindle and coolant readouts (spindle.c:87-128, canonical_machine.c:1640-1645):
   * the outputs as last driven by the executors, each field sampled on its own.
   * Read-only (set_nul); display only, never an interlock input.
   */
  spindle_get_spe: 'value',
  spindle_get_spd: 'value',
  spindle_get_spc: 'value',
  spindle_get_sps: 'value',
  coolant_get_cof: 'value',
  coolant_get_com: 'value',

  _reserved_hold_setting: 'stub',

  get_nul: 'constant',
  /** Retired settings answer 0 (config_app.c:88-95). */
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
  /** GET of `me` energizes, of `md` de-energizes every motor (stepper.c:1609-1632): Z can fall. */
  st_set_me: 'sideEffect',
  st_set_md: 'sideEffect',
  /** GET fakes an exception report (report.c:164-167). */
  rpt_er: 'sideEffect',
  /** GET starts an ADC conversion on the J13/SPI2 pin (config_app.c:660). */
  hw_get_adc3: 'sideEffect',
  /** GET resets the queue-report counter it returns (report.c:849-863). */
  qi_get: 'sideEffect',
  qo_get: 'sideEffect',

  /** rt heartbeat interval, quiescence token and uptime (runtime.c:99-105, :120-139, :179-185). */
  rt_get_hb: 'session',
  rt_get_qt: 'session',
  rt_get_up: 'session',
  /**
   * rt feed-limit report of the running move (runtime.c:214-293), the push interval (runtime.c:491-497) and the
   * summary request, whose GET pushes an fs line after its reply (runtime.c:547-563).
   */
  rt_get_flk: 'session',
  rt_get_flm: 'session',
  rt_get_flp: 'session',
  rt_get_flf: 'session',
  rt_get_fi: 'session',
  rt_get_fs: 'session',
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
  /** A retired setting accepted only for backup compatibility (config_app.c:88-111). */
  | 'legacy'
  | 'group'
  /**
   * Runtime session state (rt heartbeat interval, quiescence token): RAM
   * only, off at every reset, accepted only inside a pure `{"rt":...}`
   * envelope (runtime.c:95-118, :153-177, :187-212). Never a setting; run
   * does not send it.
   */
  | 'session';

export const SETTER_CLASS: Readonly<Record<string, SetterClass>> = Object.freeze({
  set_nul: 'readOnly',

  cm_set_am: 'value',
  /**
   * 450.02 range-checked stores (EN canonical_machine.c:2821-2892, :1018-1029; pwm.c:160-167): each refuses a
   * non-finite or out-of-range value with a status and otherwise stores it with set_flu or set_flt as before, with
   * the same unit conversion. A persisted write during a cycle is refused with status 117 (config.c:182-187).
   */
  cm_set_axis_rate: 'value',
  cm_set_coord_value: 'value',
  cm_set_ct: 'value',
  cm_set_ja: 'value',
  cm_set_jd: 'value',
  cm_set_radius: 'value',
  cm_set_xjh: 'value',
  cm_set_xjm: 'value',
  hw_set_hv: 'value',
  json_set_jv: 'value',
  pwm_set_frq: 'value',
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

  rt_set_hb: 'session',
  rt_set_qt: 'session',
  /** Feed-limit push interval: 0 off, 1..60 s (clamped), off to on only at quiescence (runtime.c:499-545). */
  rt_set_fi: 'session',
  rt_set_grp: 'session',
});

export function getterClass(getter: string): GetterClass | undefined {
  return Object.hasOwn(GETTER_CLASS, getter) ? GETTER_CLASS[getter] : undefined;
}

export function setterClass(setter: string): SetterClass | undefined {
  return Object.hasOwn(SETTER_CLASS, setter) ? SETTER_CLASS[setter] : undefined;
}
