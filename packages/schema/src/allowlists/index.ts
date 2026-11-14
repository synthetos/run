/** Per-dialect read allowlists (ROADMAP P0-09; PN §12.3). */
import { REMOVED_HOLD_KEYS, OVERRIDE_SETTINGS } from '../firmware45005.ts';
import { frozenSet } from '../frozen.ts';
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

const EN_45005_READ: ReadAllowlist = Object.freeze({ ...TINYG_EN_READ, allow: frozenSet([...TINYG_EN_READ.allow].filter(key => !REMOVED_HOLD_KEYS.includes(key)).concat(OVERRIDE_SETTINGS.map(def => def.token))) });

/** The allowlist for a dialect id; throws for a dialect that has none (g2core is read-only and has no allowlist yet). */
export function readAllowlistFor(dialectId: string, fb?: number): ReadAllowlist {
  if (!Object.hasOwn(READ_ALLOWLISTS, dialectId)) throw new Error(`no read allowlist for dialect ${JSON.stringify(dialectId)}`);
  if (dialectId === 'tinyg-en' && fb !== undefined && fb >= 450.05) return EN_45005_READ;
  return READ_ALLOWLISTS[dialectId as TinyGDialectId];
}

/** May the app GET `token` on `dialectId`? A dialect without an allowlist allows nothing. */
export function isReadAllowed(dialectId: string, token: string, fb?: number): boolean {
  if (!Object.hasOwn(READ_ALLOWLISTS, dialectId)) return false;
  return readDecision(readAllowlistFor(dialectId, fb), token).allowed;
}

export function readDecisionFor(dialectId: string, token: string, fb?: number): ReadDecision {
  if (!Object.hasOwn(READ_ALLOWLISTS, dialectId)) return { allowed: false, reason: `no read allowlist for dialect ${JSON.stringify(dialectId)}` };
  return readDecision(readAllowlistFor(dialectId, fb), token);
}

/** `{"<token>":null}` for an allowlisted token on `dialectId`; throws otherwise. */
export function getLineFor(dialectId: string, token: string, fb?: number): string {
  return getLine(readAllowlistFor(dialectId, fb), token);
}
