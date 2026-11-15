/** TinyG tag 450.06 (701c3876), config_app.c:702-715 and docs/live-feed-wire.md.
 * These values are RAM-only. Run exposes pure reads; override writes are a later task.
 */
import type { TokenDef } from './tables/types.ts';
export const SPINDLE_OVERRIDE_SETTINGS: readonly TokenDef[] = Object.freeze(([
  ['sso', 'float', 3, 'spindle_get_sso', 'spindle_set_sso'],
  ['ssoe', 'integer', 0, 'spindle_get_ssoe', 'spindle_set_ssoe'],
  ['ssc', 'float', 3, 'ov_get_ssc', 'set_nul'],
  ['scp', 'integer', 0, 'spindle_get_scp', 'set_nul'],
  ['sse', 'integer', 0, 'spindle_get_sse', 'set_nul'],
] as const).map(([token, type, precision, getter, setter]) => Object.freeze({ token, group: '', type, precision, persist: false, getter, setter })));
