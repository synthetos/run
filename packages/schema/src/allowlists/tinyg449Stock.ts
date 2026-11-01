/**
 * Read allowlist for `tinyg-449-stock` (stock edge-0.97, build 449.01),
 * checked against vendor/tinyg-hil-tables/d449.json (ROADMAP P0-09; PN §12.3).
 * This dialect is always READ_ONLY; reads are all it gets.
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
  REQUIRED_DENY,
  SR_FIELD_TOKENS,
  commonGroupedTokens,
  cross,
} from './tinygCommon.ts';

export const TINYG_449_STOCK_READ: ReadAllowlist = defineReadAllowlist({
  dialectId: 'tinyg-449-stock',
  table: 'd449',
  allow: [
    ...COMMON_GROUPS,
    /** Input states in1..in8 (`get_int`, read-only). */
    'in',
    ...cross(['in'], ['1', '2', '3', '4', '5', '6', '7', '8']),
    ...commonGroupedTokens(),
    ...COMMON_SYS_TOKENS,
    'rxm',
    ...LIVE_STATE_TOKENS,
    'admo',
    'srs',
    ...SR_FIELD_TOKENS,
  ],
  deny: {
    ...REQUIRED_DENY,
    ...COMMON_DENY,
    set: 'protocol plumbing (`set_not`), not a value',
    tid: 'transaction-id plumbing, not a value',
    txt: 'text-mode wrapper: `{"txt":...}` runs a text-mode command; never sent',
  },
  denyPrefixes: { ...JOG_PREFIX_DENY },
});
