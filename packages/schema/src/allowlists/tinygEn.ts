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
    /** Motor enabled flags (EN stepper.c:1384-1393). */
    ...cross(['pwr'], MOTORS),
    ...commonGroupedTokens(),
    ...COMMON_SYS_TOKENS,
    /** EN-only `sys` members (EN config_app.c:650-668): the polarity keys, optional stop, line mode, and the reserved settings that answer 17. */
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
    /** Short status report (EN report.c:621-624). */
    'srs',
    /** Stack watermark diagnostic (EN stack_report.c:47-60); one of the capability-probe tokens (PN §2.3). */
    'fstk',
    ...SR_FIELD_TOKENS,
    /**
     * Spindle and coolant readouts (EN config_app.c:686-692; spindle.c:87-128,
     * canonical_machine.c:1560-1565): read-only (`set_nul`), pure getters of the
     * outputs as last driven. Display only: each is sampled on its own and a
     * queued M5/M9/M30 reads "on" until it runs, so nothing may gate on them.
     */
    'spe',
    'spd',
    'spc',
    'sps',
    'cof',
    'com',
  ],
  deny: {
    ...REQUIRED_DENY,
    ...COMMON_DENY,
    fd: 'retired on edge-next: answers a constant 0 (EN config_app.c:88-95), not the board state',
    ma: 'retired on edge-next: answers a constant 0 (EN config_app.c:88-95), not the board state',
    net: 'retired on edge-next: answers a constant 0 (EN config_app.c:88-95), not the board state',
    set: 'protocol plumbing (`set_not`), not a value',
    tid: 'transaction-id plumbing (PN §5.3), not a value',
    txt: 'text-mode wrapper: `{"txt":...}` runs a text-mode command; never sent',
    rt: 'runtime session family (EN config_app.c:680-685, :737): answers only inside a pure {"rt":...} envelope (EN runtime.c:94-104); a write starts a heartbeat or installs a quiescence token. run does not use it',
    rthb: 'rt heartbeat interval: a session control, not a value; answers only inside a pure {"rt":...} envelope (EN runtime.c:98-117)',
    rtqt: 'rt quiescence token: a session control, not a value; answers only inside a pure {"rt":...} envelope (EN runtime.c:119-176)',
    rtup: 'rt uptime: answers only inside a pure {"rt":...} envelope (EN runtime.c:178-184)',
  },
  denyPrefixes: { ...JOG_PREFIX_DENY },
});
