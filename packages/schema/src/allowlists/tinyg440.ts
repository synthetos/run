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
    /** Every common group except `pwr`, whose members answer a false constant on 440.21 (see the deny entries). */
    ...COMMON_GROUPS.filter((g) => g !== 'pwr'),
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
    ...Object.fromEntries(
      ['pwr', ...cross(['pwr'], MOTORS)].map((t) => [
        t,
        'answers "disabled" whatever the motor state on 440.21: TG `_get_motor()` takes the motor from group[0], which is "p" for the pwr rows (index 63, the default case), so the readout is false (TG stepper.c:1147-1150, :338-348, :1236-1241; fixed on edge-next as E108)',
      ]),
    ),
    _dam: 'debug dump of the active model as printf text (TG canonical_machine.c:1802-1812), not JSON',
  },
  denyPrefixes: { ...JOG_PREFIX_DENY },
});
