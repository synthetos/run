/**
 * Read allowlists: which tokens the app may GET, per dialect (ROADMAP P0-09;
 * PN §12.3; SAFETY H37, §8 item 27).
 *
 * On TinyG some GETs act on the machine (E138 is still open on edge-next):
 * a GET of `md` de-energizes every motor and Z can fall, `me` energizes them,
 * `alarm`/`panic`/`shutd` raise those states, `clear`/`clr` clear an alarm,
 * `er` fakes an exception. So reads are refused by default: a token may be
 * read only when the dialect's reviewed allowlist names it, and never when
 * its deny list or a deny prefix names it.
 *
 * The lists are hand-written data, deliberately NOT derived from the
 * vendored tables: a firmware bump that adds a token must fail CI until a
 * reviewer classifies it (RUN_PLAN §8.2). The tests hold every list to its
 * table: every table token is allowed or denied, every allowed token exists
 * and has a side-effect-free getter, and a group is allowed only when all
 * of its members are.
 */
import { frozenMap, frozenSet } from '../frozen.ts';
import type { TableName, TinyGDialectId } from '../tables/types.ts';

export interface ReadAllowlist {
  readonly dialectId: TinyGDialectId;
  /** The vendored table this list is checked against. */
  readonly table: TableName;
  /** Tokens (single keys or group names) the app may GET. */
  readonly allow: ReadonlySet<string>;
  /** Tokens that are never read, with the reason. */
  readonly deny: ReadonlyMap<string, string>;
  /** Token prefixes that are never read (`jog*`), with the reason. */
  readonly denyPrefixes: ReadonlyMap<string, string>;
}

export interface ReadAllowlistSpec {
  readonly dialectId: TinyGDialectId;
  readonly table: TableName;
  readonly allow: readonly string[];
  readonly deny: Readonly<Record<string, string>>;
  readonly denyPrefixes: Readonly<Record<string, string>>;
}

export type ReadDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Builds a frozen allowlist. Throws if a token is listed twice, or is both
 * allowed and denied (directly or by prefix): a contradiction in a safety
 * list is a bug, not something to resolve by precedence.
 */
export function defineReadAllowlist(spec: ReadAllowlistSpec): ReadAllowlist {
  const where = `read allowlist ${spec.dialectId}`;
  for (const [token, reason] of [...Object.entries(spec.deny), ...Object.entries(spec.denyPrefixes)]) {
    if (token.length === 0 || reason.trim().length === 0) throw new Error(`${where}: deny entry ${JSON.stringify(token)} needs a token and a reason`);
  }
  const seen = new Set<string>();
  for (const token of spec.allow) {
    if (seen.has(token)) throw new Error(`${where}: ${token} is allowed twice`);
    seen.add(token);
    if (Object.hasOwn(spec.deny, token)) throw new Error(`${where}: ${token} is both allowed and denied`);
    const prefix = Object.keys(spec.denyPrefixes).find((p) => token.startsWith(p));
    if (prefix !== undefined) throw new Error(`${where}: ${token} is allowed but denied by the prefix ${prefix}`);
  }
  return Object.freeze({
    dialectId: spec.dialectId,
    table: spec.table,
    allow: frozenSet(spec.allow),
    deny: frozenMap(Object.entries(spec.deny)),
    denyPrefixes: frozenMap(Object.entries(spec.denyPrefixes)),
  });
}

/**
 * May the app GET `token` on this dialect? Denials win; anything not on the
 * allowlist is refused. The match is exact: TinyG tokens are lower case and
 * the allowlist holds them as the firmware spells them, so `MD` or ` md` is
 * refused as unknown rather than normalised into something that might pass.
 */
export function readDecision(list: ReadAllowlist, token: string): ReadDecision {
  const lower = token.toLowerCase();
  const denied = list.deny.get(token) ?? list.deny.get(lower);
  if (denied !== undefined) return { allowed: false, reason: denied };
  for (const [prefix, reason] of list.denyPrefixes) {
    if (lower.startsWith(prefix)) return { allowed: false, reason };
  }
  if (list.allow.has(token)) return { allowed: true };
  return { allowed: false, reason: `"${token}" is not on the ${list.dialectId} read allowlist` };
}

/** Thrown by `getLine` for a token that may not be read: a bug in the calling code path (SAFETY §7). */
export class ReadNotAllowedError extends Error {
  readonly token: string;
  readonly dialectId: TinyGDialectId;

  constructor(dialectId: TinyGDialectId, token: string, reason: string) {
    super(`read of "${token}" refused on ${dialectId}: ${reason}`);
    this.name = 'ReadNotAllowedError';
    this.token = token;
    this.dialectId = dialectId;
  }
}

/**
 * The one way to build a JSON GET line: `{"<token>":null}`, only for an
 * allowlisted token. Anything else throws, and the line is never built
 * (SAFETY §7: "throw in code; FAULT if it happens while connected").
 */
export function getLine(list: ReadAllowlist, token: string): string {
  const decision = readDecision(list, token);
  if (!decision.allowed) throw new ReadNotAllowedError(list.dialectId, token, decision.reason);
  return `{"${token}":null}`;
}
