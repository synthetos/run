/** Feed telemetry only: never changes motion or acknowledges a command. Frozen at TinyG c7f9b7e2 runtime.c:475-515,652-685. */
import type { JsonObject } from '@synthetos/protocol';
import type { FeedLimitState, FeedSummary, FeedMove, FeedGaps } from './types.ts';

/** A fresh window for a job that just opened one. */
export function feedLimitWindow(fi: number): FeedLimitState {
  return { fi, gaps: null, first: null, prev: null, last: null, move: null, short: false, unsupported: false };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** An `fs` body as a summary; 'unsupported' for a format version run does not read; null for a malformed one. */
export function parseFeedSummary(body: JsonObject): FeedSummary | 'unsupported' | null {
  if (body['v'] !== 1 && body['v'] !== 2) return finite(body['v']) ? 'unsupported' : null;
  const c = body['c'];
  const count = body['v'] === 2 ? 7 : 6;
  if (!Array.isArray(c) || c.length < count || !c.every(finite) || !finite(body['e']) || !finite(body['q']) || !finite(body['ct']) || !finite(body['cd'])) return null;
  return Object.freeze({ e: body['e'], q: body['q'], c: Object.freeze(c.slice(0, count) as number[]), ct: body['ct'], cd: body['cd'] });
}

/** An `fl` body as the executing move's limit; null for a malformed one. Missing `m`, `p`, `n` read as 0, null, null. */
export function parseFeedMove(body: JsonObject): FeedMove | null {
  if (!finite(body['k'])) return null;
  return Object.freeze({ k: body['k'], m: finite(body['m']) ? body['m'] : 0, p: finite(body['p']) ? body['p'] : null, n: finite(body['n']) ? body['n'] : null, ...(body['g'] === 1 || body['g'] === 2 ? { g: body['g'] } : {}) });
}

/**
 * Folds one feed-limit push into the window (pure; the UI's replay tests use it too). A summary of a new window epoch
 * starts over; one that does not advance the sequence is ignored (a repeat or a late frame); the executing move
 * replaces the last one.
 */
export function foldFeedLimit(state: FeedLimitState, kind: 'fs' | 'fl' | 'fg', body: JsonObject, short: boolean): FeedLimitState {
  if (kind === 'fl') {
    const move = parseFeedMove(body);
    return move === null ? state : { ...state, move };
  }
  if (kind === 'fg') {
    const gaps = parseFeedGaps(body);
    // Firmware sends fs first. Never attach a duplicate, stale or unpaired fg to a different summary.
    if (gaps === null || state.last?.e !== gaps.e || state.last.q !== gaps.q || state.gaps !== null) return state;
    return { ...state, gaps };
  }
  const fs = parseFeedSummary(body);
  if (fs === null) return state;
  if (fs === 'unsupported') return state.unsupported ? state : { ...state, unsupported: true };
  const sameWindow = state.last !== null && state.last.e === fs.e;
  if (sameWindow && fs.q <= (state.last as FeedSummary).q) return state;
  return { ...state, gaps: null, first: sameWindow && state.first !== null ? state.first : fs, prev: sameWindow ? state.last : null, last: fs, short: state.short || short };
}


/** Known counters only; future object keys are ignored. Malformed numbers never produce attribution. */
export function parseFeedGaps(body: JsonObject): FeedGaps | null {
  const uint = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
  const g = body['g'], b = body['b'];
  if (!uint(body['e']) || body['e'] > 65535 || !uint(body['q']) || !Array.isArray(g) || g.length < 3 || !g.slice(0, 3).every(uint) || !Array.isArray(b) || b.length < 3) return null;
  const pairs: number[][] = [];
  for (const p of b.slice(0, 3)) {
    if (!Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every(uint)) return null;
    pairs.push(p.slice(0, 2) as number[]);
  }
  return { e: body['e'], q: body['q'], g: g.slice(0, 3) as number[], b: pairs, short: body['x'] === 1 };
}
