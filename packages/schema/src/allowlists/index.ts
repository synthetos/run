/** Per-dialect read allowlists (ROADMAP P0-09; PN §12.3). */
import type { TinyGDialectId } from '../tables/types.ts';
import { getLine, readDecision } from './readAllowlist.ts';
import type { ReadAllowlist, ReadDecision } from './readAllowlist.ts';
import { TINYG_440_READ } from './tinyg440.ts';
import { TINYG_449_STOCK_READ } from './tinyg449Stock.ts';
import { TINYG_EN_READ } from './tinygEn.ts';

export { ReadNotAllowedError, defineReadAllowlist, getLine, readDecision } from './readAllowlist.ts';
export type { ReadAllowlist, ReadAllowlistSpec, ReadDecision } from './readAllowlist.ts';
export { TINYG_440_READ, TINYG_449_STOCK_READ, TINYG_EN_READ };

export const READ_ALLOWLISTS: Readonly<Record<TinyGDialectId, ReadAllowlist>> = Object.freeze({
  'tinyg-en': TINYG_EN_READ,
  'tinyg-440': TINYG_440_READ,
  'tinyg-449-stock': TINYG_449_STOCK_READ,
});

/** The allowlist for a dialect id; throws for a dialect that has none (g2core is read-only and has no allowlist yet). */
export function readAllowlistFor(dialectId: string): ReadAllowlist {
  if (!Object.hasOwn(READ_ALLOWLISTS, dialectId)) throw new Error(`no read allowlist for dialect ${JSON.stringify(dialectId)}`);
  return READ_ALLOWLISTS[dialectId as TinyGDialectId];
}

/** May the app GET `token` on `dialectId`? A dialect without an allowlist allows nothing. */
export function isReadAllowed(dialectId: string, token: string): boolean {
  if (!Object.hasOwn(READ_ALLOWLISTS, dialectId)) return false;
  return readDecision(READ_ALLOWLISTS[dialectId as TinyGDialectId], token).allowed;
}

export function readDecisionFor(dialectId: string, token: string): ReadDecision {
  if (!Object.hasOwn(READ_ALLOWLISTS, dialectId)) return { allowed: false, reason: `no read allowlist for dialect ${JSON.stringify(dialectId)}` };
  return readDecision(READ_ALLOWLISTS[dialectId as TinyGDialectId], token);
}

/** `{"<token>":null}` for an allowlisted token on `dialectId`; throws otherwise. */
export function getLineFor(dialectId: string, token: string): string {
  return getLine(readAllowlistFor(dialectId), token);
}
