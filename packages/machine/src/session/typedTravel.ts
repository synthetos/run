/**
 * The check of one typed move (H91, owner 2026-11-09): the job's own checks on a one-line program.
 *
 * The line is sanitised with the board's values as read for it (the job sanitiser, SAFETY §4.7, with the live start
 * state: position, modes, offsets, and the feed in effect), then its box is checked against the travel (OD-24,
 * travelCheck.ts), exactly as a job's lines are at Start. The outcome is one of:
 *
 * - `clear`: send it;
 * - `refused`: not sent, with the reason in plain words (a sanitiser block, a move longer than one queued move, a
 *   move past the travel of an axis homed in this connection, no feed);
 * - `confirm`: the travel cannot be checked (an axis not homed, a limit or a position not read): the same finding the
 *   job start asks C40 or C41 for. The page offers Home, Move anyway or Cancel; "Move anyway" sends the line again
 *   with this finding's text, and the session matches it exactly (as at Start, review S3).
 *
 * Pure. The session runs it once its check reads are in (typedMove.ts); the page may run it on the same values to
 * show the decision before anything is sent.
 */
import { CEILING_SECONDS, parseTypedLine, type StartState } from '@synthetos/safety';
import { liveStart, sanitizeLive } from './job.ts';
import { checkTravel } from './travelCheck.ts';
import type { TravelFinding } from './travelTypes.ts';
import type { SessionState } from './types.ts';

export type TypedCheck =
  | { readonly kind: 'clear' }
  | { readonly kind: 'refused'; readonly text: string }
  | { readonly kind: 'confirm'; readonly finding: TravelFinding };

/** G1, G2 or G3 with no F in the line and none in effect. */
export const TYPED_NO_FEED = 'No feed is set. Add a feed, e.g. F500.';
/** A move the sanitiser would split (SAFETY §4.3 ceiling). */
export const TYPED_TOO_LONG = `That move takes longer than ${CEILING_SECONDS.default} s, the most Run queues at once. Use shorter moves, or open it as a job.`;

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

/** Checks one typed line against the board as `s` holds it (H91). */
export function typedCheck(s: SessionState, line: string): TypedCheck {
  const parsed = parseTypedLine(line);
  if (!parsed.ok) return refused(`${parsed.reason} ${parsed.remedy}`);
  const { motion, words } = parsed.value;
  if (s.dialect === null) return refused('No board is identified.');
  if ((motion === 1 || motion === 2 || motion === 3) && words.F === undefined && feedInEffect(s) === undefined) return refused(TYPED_NO_FEED);
  const result = sanitizeLive(s, line, false, typedStart(s));
  const block = result.report.entries.find((e) => e.severity === 'block');
  if (block !== undefined) return refused(`Not sent: ${block.message}.`);
  // Refusals come before a question: the user is never asked to confirm a move that is then refused.
  const travel = checkTravel(s, result.extents);
  if (travel.block !== null) return refused(`Not sent: ${findingWords(travel.block)}.`);
  if (result.lines.length !== 1) return refused(TYPED_TOO_LONG);
  // Defence in depth: the sanitiser sends exactly the typed line (it may only add its N word).
  /* c8 ignore next -- a canonical typed line is never changed by the sanitiser */
  if ((result.lines[0] as { readonly body: string }).body !== line) return refused('Run would have to change that line to send it. Type it again.');
  if (travel.confirm !== null) return { kind: 'confirm', finding: travel.confirm };
  return { kind: 'clear' };
}
