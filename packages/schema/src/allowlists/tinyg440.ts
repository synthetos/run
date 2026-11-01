/**
 * Read allowlist for `tinyg-440` (TinyG master, build 440.21), checked against
 * vendor/tinyg-hil-tables/d440.json (ROADMAP P0-09; PN §12.3).
 *
 * CODEOWNERS: the owner reviews every change. Adding a readable token is a
 * safety decision (SAFETY §8 item 27): read its get function first.
 */
import { defineReadAllowlist } from './readAllowlist.ts';
import type { ReadAllowlist } from './readAllowlist.ts';
import {
  COMMON_DENY,
  COMMON_GROUPS,
  COMMON_SYS_TOKENS,
  JOG_PREFIX_DENY,
  LIVE_STATE_TOKENS,
  MOTORS,
  REQUIRED_DENY,
  SR_FIELD_TOKENS,
  commonGroupedTokens,
  cross,
} from './tinygCommon.ts';

export const TINYG_440_READ: ReadAllowlist = defineReadAllowlist({
  dialectId: 'tinyg-440',
  table: 'd440',
  allow: [
    ...COMMON_GROUPS,
    /** Motor enabled flags (TG `st_get_pwr`). */
    ...cross(['pwr'], MOTORS),
    ...commonGroupedTokens(),
    ...COMMON_SYS_TOKENS,
    /** 440.21-only `sys` member (`get_ui8`). */
    'net',
    ...LIVE_STATE_TOKENS,
    /** Real settings on 440.21 (`get_ui8`, `get_flt`), retired on edge-next. `fd` is never written (PN §12.4). */
    'fd',
    'ma',
    ...SR_FIELD_TOKENS,
  ],
  deny: {
    ...REQUIRED_DENY,
    ...COMMON_DENY,
    _dam: 'debug dump of the active model as printf text (TG canonical_machine.c:1802-1812), not JSON',
  },
  denyPrefixes: { ...JOG_PREFIX_DENY },
});
