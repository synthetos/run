/**
 * Read allowlist for `tinyg-en` (TinyG edge-next), checked against
 * vendor/tinyg-hil-tables/den.json (ROADMAP P0-09; PN §12.3).
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

export const TINYG_EN_READ: ReadAllowlist = defineReadAllowlist({
  dialectId: 'tinyg-en',
  table: 'den',
  allow: [
    ...COMMON_GROUPS,
    /** Input states in1..in8 (EN config_app.c, `get_int`, read-only). */
    'in',
    ...cross(['in'], ['1', '2', '3', '4', '5', '6', '7', '8']),
    /** Motor enabled flags (EN stepper.c:1356-1365). */
    ...cross(['pwr'], MOTORS),
    ...commonGroupedTokens(),
    ...COMMON_SYS_TOKENS,
    /** EN-only `sys` members (EN config_app.c:649-667): the polarity keys, optional stop, line mode, and the reserved settings that answer 17. */
    'os',
    'prbp',
    'rxm',
    'spdp',
    'spep',
    'coph',
    'spde',
    'spph',
    ...LIVE_STATE_TOKENS,
    'admo',
    /** Short status report (EN report.c:612-615). */
    'srs',
    /** Stack watermark diagnostic (EN stack_report.c:47-60); one of the capability-probe tokens (PN §2.3). */
    'fstk',
    ...SR_FIELD_TOKENS,
  ],
  deny: {
    ...REQUIRED_DENY,
    ...COMMON_DENY,
    fd: 'retired on edge-next: answers a constant 0 (EN config_app.c:87-94), not the board state',
    ma: 'retired on edge-next: answers a constant 0 (EN config_app.c:87-94), not the board state',
    net: 'retired on edge-next: answers a constant 0 (EN config_app.c:87-94), not the board state',
    set: 'protocol plumbing (`set_not`), not a value',
    tid: 'transaction-id plumbing (PN §5.3), not a value',
    txt: 'text-mode wrapper: `{"txt":...}` runs a text-mode command; never sent',
  },
  denyPrefixes: { ...JOG_PREFIX_DENY },
});
