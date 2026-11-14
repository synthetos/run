/** Reviewed delta at TinyG 450.05 (0e807169), config_app.c:701-712 and docs/live-feed-wire.md.
 * Override getters are pure; none has a Run write overlay in Part A.
 */
import type { TokenDef } from './tables/types.ts';
export const REMOVED_HOLD_KEYS: readonly string[] = Object.freeze(['spph', 'spde', 'coph']);
export const REMOVED_HOLD_REASON = 'Not on 450.05: spindle and coolant pause on hold was removed';
export const OVERRIDE_SETTINGS: readonly TokenDef[] = Object.freeze(([
  ['mfo', 'float', 3, 'ov_get_mfo', 'ov_set_mfo'],
  ['mfoe', 'integer', 0, 'ov_get_mfoe', 'ov_set_mfoe'],
  ['m48e', 'integer', 0, 'ov_get_m48e', 'ov_set_m48e'],
  ['mfc', 'float', 3, 'ov_get_mfc', 'set_nul'],
  ['mcp', 'integer', 0, 'ov_get_capped', 'set_nul'],
  ['mfe', 'integer', 0, 'rt_get_mfe', 'set_nul'],
] as const).map(([token, type, precision, getter, setter]) => Object.freeze({ token, group: '', type, precision, persist: false, getter, setter })));
