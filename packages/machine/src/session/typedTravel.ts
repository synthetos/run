/**
 * The check of one typed move (H91, owner 2026-11-09; OD-31): the job's own checks on a one-line program.
 *
 * The line is sanitised with the board's values as read for it (the job sanitiser, SAFETY §4.7, with the live start
 * state: position, modes, offsets, and the feed in effect), then the whole line's box is checked against the travel
 * (OD-24, travelCheck.ts), exactly as a job's lines are at Start. The outcome is one of:
 *
 * - `clear`: send it, as `pieces`;
 * - `refused`: not sent, with the reason in plain words (a sanitiser block, a move that cannot be split into short
 *   pieces, a move past the travel of an axis homed in this connection, no feed);
 * - `confirm`: the travel cannot be checked (an axis not homed, a limit or a position not read): the same finding the
 *   job start asks C40 or C41 for. The page offers Home, Move anyway or Cancel; "Move anyway" sends the line again
 *   with this finding's text, and the session matches it exactly (as at Start, review S3).
 *
 * Pieces (OD-31, owner 2026-11-09: "split"): a long line is sent as the sanitiser's own split, the way a job's long
 * moves are, but cut short enough that `lookahead` pieces queued together stay within the queued-motion ceiling
 * (SAFETY §4.3): each piece is at most ceiling / lookahead of modelled time (1.25 s at the defaults). Keeping several
 * queued lets the planner run through them without braking between them (bench 2: with one piece waiting, each piece
 * slowed to 0). The pieces are sized by sanitising again with `k` scaled down, so the sanitiser's minimum ceiling (2 s)
 * still applies to its own check; the split itself (straight moves divided exactly, arcs into sub-arcs) is the
 * sanitiser's. A short line is one piece: the line itself.
 *
 * Pure. The session runs it once its check reads are in (typedMove.ts).
 */
import type { Dialect } from '@synthetos/protocol';
import { CEILING_SECONDS, parseTypedLine, sanitizeJob, type StartState } from '@synthetos/safety';
import { liveMotion, liveStart, sanitizeLive } from './job.ts';
import { MOTION_LIMITS } from './motion.ts';
import { checkTravel } from './travelCheck.ts';
import type { TravelFinding } from './travelTypes.ts';
import type { SessionState } from './types.ts';

export type TypedCheck =
  | { readonly kind: 'clear'; readonly pieces: readonly string[] }
  | { readonly kind: 'refused'; readonly text: string }
  | { readonly kind: 'confirm'; readonly finding: TravelFinding; readonly pieces: readonly string[] };

/** G1, G2 or G3 with no F in the line and none in effect. */
export const TYPED_NO_FEED = 'No feed is set. Add a feed, e.g. F500.';
/** A move the sanitiser cannot split into pieces short enough (OD-31). */
export const TYPED_TOO_LONG = "That move can't be split into short enough pieces. Open it as a job.";

/** Longest modelled time of one piece, s: `lookahead` pieces fit in the default ceiling (SAFETY §4.3). */
export const TYPED_PIECE_SECONDS = CEILING_SECONDS.default / MOTION_LIMITS.lookahead;
/** Longest piece text: the write gate's motion cap less the LF. */
const MAX_PIECE_CHARS = 63;

function refused(text: string): TypedCheck {
  return { kind: 'refused', text };
}

/**
 * The feed in effect, mm/min, from the `feed` read: only in millimetres (in inches the unit of the reported feed is
 * not relied on), and only when it was read with status 0 and is more than 0. Otherwise unknown.
 */
export function feedInEffect(s: SessionState): number | undefined {
  const feed = s.values['feed'];
  const unit = s.values['unit'];
  if (feed === undefined || unit === undefined || feed.status !== 0 || unit.status !== 0 || unit.value !== 1) return undefined;
  return typeof feed.value === 'number' && Number.isFinite(feed.value) && feed.value > 0 ? feed.value : undefined;
}

/** The start state of a one-line program: the job's live start, plus the feed in effect. */
function typedStart(s: SessionState): StartState {
  const feed = feedInEffect(s);
  return { ...liveStart(s), ...(feed === undefined ? {} : { feedMmPerMin: feed }) };
}

/** The finding's words without the job's "line 1: " prefix. */
export function findingWords(finding: TravelFinding): string {
  return finding.text.replace(/^line \d+: /, '');
}

/**
 * The line as pieces of at most `TYPED_PIECE_SECONDS` modelled time each, or null when that cannot be done. The
 * sanitiser's ceiling stays at its minimum (2 s) and `k` is scaled so its split budget is the piece time.
 */
export function typedPieces(s: SessionState, line: string, start: StartState = typedStart(s)): readonly string[] | null {
  const motion = liveMotion(s);
  const ceilingSeconds = CEILING_SECONDS.min;
  const result = sanitizeJob(line, s.dialect as Dialect, { motion: { ...motion, ceilingSeconds, k: (motion.k * TYPED_PIECE_SECONDS) / ceilingSeconds }, start, c22: false });
  if (result.report.blocked) return null;
  const pieces = result.lines.map((l) => l.body);
  // Every piece must itself be a typed move within the motion cap (the write gate refuses anything else as well).
  /* c8 ignore next -- defence in depth: a piece carries the line's own words with at most 4 decimals */
  if (pieces.some((p) => p.length > MAX_PIECE_CHARS || !parseTypedLine(p).ok)) return null;
  return pieces;
}

/** Checks one typed line against the board as `s` holds it (H91, OD-31). */
export function typedCheck(s: SessionState, line: string): TypedCheck {
  const parsed = parseTypedLine(line);
  if (!parsed.ok) return refused(`${parsed.reason} ${parsed.remedy}`);
  const { motion, words } = parsed.value;
  if (s.dialect === null) return refused('No board is identified.');
  if ((motion === 1 || motion === 2 || motion === 3) && words.F === undefined && feedInEffect(s) === undefined) return refused(TYPED_NO_FEED);
  const start = typedStart(s);
  const result = sanitizeLive(s, line, false, start);
  const block = result.report.entries.find((e) => e.severity === 'block');
  if (block !== undefined) return refused(`Not sent: ${block.message}.`);
  // Refusals come before a question: the user is never asked to confirm a move that is then refused.
  const travel = checkTravel(s, result.extents);
  if (travel.block !== null) return refused(`Not sent: ${findingWords(travel.block)}.`);
  const pieces = typedPieces(s, line, start);
  if (pieces === null) return refused(TYPED_TOO_LONG);
  if (travel.confirm !== null) return { kind: 'confirm', finding: travel.confirm, pieces };
  return { kind: 'clear', pieces };
}
