/**
 * Forbidden writes (ROADMAP P0-09; PN §12.4; SAFETY §4.6, H11, H24, H40).
 *
 * Keys run must never write in a settings write plan, per TinyG dialect.
 * Some are forbidden outright; three only outside a consented session
 * normalisation (`fd`, `jv`, `qv`: H24), two only outside commissioning
 * (`me`, `md`), and one only for one value (`js=0`).
 *
 * These rules apply to every write path. The settings write plan (writePlan.ts)
 * never passes a context, so for it every conditional rule is in force.
 */
import { frozenMap } from './frozen.ts';
import type { TinyGDialectId } from './tables/types.ts';

export type ForbiddenWhen =
  /** Never written. */
  | { readonly kind: 'always' }
  /** Never written with one of these values. */
  | { readonly kind: 'values'; readonly values: readonly number[] }
  /** Written only by the commissioning flow (SAFETY §4.8). */
  | { readonly kind: 'exceptCommissioning' }
  /** Written only by a consented, restored session normalisation (SAFETY H24, §4.6). */
  | { readonly kind: 'exceptConsentedNormalisation' };

export interface ForbiddenRule {
  readonly when: ForbiddenWhen;
  readonly reason: string;
}

export interface ForbiddenWrites {
  readonly dialectId: TinyGDialectId;
  /** Exact tokens. */
  readonly tokens: ReadonlyMap<string, ForbiddenRule>;
  /** Token prefixes (`jog*`). */
  readonly prefixes: ReadonlyMap<string, ForbiddenRule>;
}

/** Who is asking. Every flag defaults to false: a caller that passes nothing gets every rule. */
export interface WriteContext {
  readonly commissioning?: boolean;
  readonly consentedNormalisation?: boolean;
}

const ALWAYS: ForbiddenWhen = Object.freeze({ kind: 'always' });

function rule(when: ForbiddenWhen, reason: string): ForbiddenRule {
  return Object.freeze({ when, reason });
}

/** PN §12.4, as it applies to every TinyG dialect. */
const COMMON: Readonly<Record<string, ForbiddenRule>> = Object.freeze({
  hv: rule(ALWAYS, 'hardware version: a wrong value changes the pin map the firmware drives (PN §12.4, SAFETY H11)'),
  baud: rule(ALWAYS, 'changes the USB baud rate and loses the connection (PN §12.4)'),
  ex: rule(ALWAYS, 'changes flow control; the streaming engine depends on it (PN §12.4, §7)'),
  ej: rule(ALWAYS, 'switches JSON/text mode; run speaks JSON only (PN §12.4)'),
  js: rule(Object.freeze({ kind: 'values', values: Object.freeze([0]) }), 'js=0 makes the board emit relaxed JSON that run does not parse (PN §12.4)'),
  defa: rule(ALWAYS, 'restores factory defaults: wipes the board configuration (PN §12.4)'),
  boot: rule(ALWAYS, 'any SET enters the bootloader (PN §12.3, AUD E138); only the flasher does that'),
  test: rule(ALWAYS, 'runs a built-in firmware test program (PN §12.4)'),
  me: rule(Object.freeze({ kind: 'exceptCommissioning' }), 'energizes the motors; commissioning only (PN §12.4)'),
  md: rule(Object.freeze({ kind: 'exceptCommissioning' }), 'de-energizes the motors: Z can fall; commissioning only (PN §12.4)'),
  rx: rule(ALWAYS, 'receive-buffer state, not a setting (PN §12.4)'),
  fd: rule(Object.freeze({ kind: 'exceptConsentedNormalisation' }), 'JSON footer depth; only in a consented, restored normalisation (PN §12.4, SAFETY H24)'),
  jv: rule(Object.freeze({ kind: 'exceptConsentedNormalisation' }), 'JSON verbosity; only in a consented, restored normalisation (PN §12.4, SAFETY H24)'),
  qv: rule(Object.freeze({ kind: 'exceptConsentedNormalisation' }), 'queue-report verbosity; only in a consented, restored normalisation (PN §12.4, SAFETY H24)'),
  ...Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [
      `se${String(i).padStart(2, '0')}`,
      rule(ALWAYS, 'status-report field selector: never copied or written (PN §12.2 E140, §12.4)'),
    ]),
  ),
});

const PREFIXES: Readonly<Record<string, ForbiddenRule>> = Object.freeze({
  jog: rule(ALWAYS, 'jog commands start motion; jogging goes through the jog planner, never a settings write (PN §12.4)'),
});

/**
 * The edge-next runtime session family (EN config_app.c:680-685, :737;
 * runtime.c): a write starts an idle heartbeat or installs a quiescence
 * token. Not a setting; run never writes it.
 */
const RT: Readonly<Record<string, ForbiddenRule>> = Object.freeze({
  rt: rule(ALWAYS, 'runtime session group (heartbeat, quiescence token): not a setting; run does not use it (EN runtime.c:186-211)'),
  rthb: rule(ALWAYS, 'starts an idle heartbeat: a session control, not a setting (EN runtime.c:106-117)'),
  rtqt: rule(ALWAYS, 'installs a quiescence token: a session control, not a setting (EN runtime.c:152-176)'),
  rtup: rule(ALWAYS, 'uptime: read-only (EN config_app.c:685)'),
});

/** `rxm` exists on edge-next and stock 449 only (PN §12.2). */
const RXM: Readonly<Record<string, ForbiddenRule>> = Object.freeze({
  rxm: rule(ALWAYS, 'switches character/line receive mode; the streaming engine depends on it (PN §12.4, §7.4)'),
});

function define(dialectId: TinyGDialectId, extra: Readonly<Record<string, ForbiddenRule>>): ForbiddenWrites {
  return Object.freeze({
    dialectId,
    tokens: frozenMap(Object.entries({ ...COMMON, ...extra })),
    prefixes: frozenMap(Object.entries(PREFIXES)),
  });
}

export const FORBIDDEN_WRITES: Readonly<Record<TinyGDialectId, ForbiddenWrites>> = Object.freeze({
  'tinyg-en': define('tinyg-en', { ...RXM, ...RT }),
  'tinyg-440': define('tinyg-440', {}),
  'tinyg-449-stock': define('tinyg-449-stock', RXM),
});

function applies(when: ForbiddenWhen, value: unknown, ctx: WriteContext): boolean {
  switch (when.kind) {
    case 'always':
      return true;
    case 'values':
      // Fail closed: a value that is not a plain number (a string "0", a
      // boolean false) is treated as forbidden too.
      return typeof value !== 'number' || when.values.includes(value);
    case 'exceptCommissioning':
      return ctx.commissioning !== true;
    case 'exceptConsentedNormalisation':
      return ctx.consentedNormalisation !== true;
  }
}

/**
 * The reason writing `token` = `value` is forbidden on this dialect, or null.
 * The token is matched case-insensitively and trimmed, so `HV` or ` hv` is
 * still forbidden (a write path must also refuse it as non-canonical).
 */
export function forbiddenWriteReason(list: ForbiddenWrites, token: string, value: unknown, ctx: WriteContext = {}): string | null {
  const key = token.trim().toLowerCase();
  const exact = list.tokens.get(key);
  if (exact !== undefined && applies(exact.when, value, ctx)) return exact.reason;
  for (const [prefix, r] of list.prefixes) {
    if (key.startsWith(prefix) && applies(r.when, value, ctx)) return r.reason;
  }
  return null;
}

export function isWriteForbidden(dialectId: TinyGDialectId, token: string, value: unknown, ctx: WriteContext = {}): boolean {
  return forbiddenWriteReason(FORBIDDEN_WRITES[dialectId], token, value, ctx) !== null;
}

/** Does any rule (whatever its condition) name this key? Such a key never gets an overlay entry. */
export function isForbiddenKey(list: ForbiddenWrites, token: string): boolean {
  const key = token.trim().toLowerCase();
  if (list.tokens.has(key)) return true;
  for (const prefix of list.prefixes.keys()) if (key.startsWith(prefix)) return true;
  return false;
}
