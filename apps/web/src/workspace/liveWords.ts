/**
 * The Live job log in plain words for Simple (first-time walk 2026-11-08, C11). The session's events are written for
 * the bench ("Streaming in line mode.", "Line mode put back: rxm 0 (saved on the board).", "Pause: feedhold sent.");
 * Simple says the same things without the firmware's keys. Advanced shows them as the session wrote them. Safety
 * notices (W-strings) are never rewritten here.
 */

const PLAIN: readonly (readonly [RegExp, string])[] = [
  [/^Streaming in line mode\.$/, 'Sending the job one line at a time.'],
  [/^Line mode put back: rxm \d+ \(saved on the board\)\.$/, 'The board’s line setting is back to what it was before the job.'],
  [/^Pause: feedhold sent\.$/, 'Pause sent.'],
];

/** An event's text for the level: plain words in Simple where the session's own words name firmware keys. */
export function liveEventText(text: string, advanced: boolean): string {
  if (advanced) return text;
  for (const [re, plain] of PLAIN) if (re.test(text)) return plain;
  return text;
}

/** The event's line label: "L17" in Advanced, "line 17" in Simple. */
export function liveLineLabel(line: number | undefined, advanced: boolean): string {
  if (line === undefined) return '';
  return advanced ? `L${String(line)}` : `line ${String(line)}`;
}

/** The empty-queue row: "The planner queue is empty." in Advanced, "Nothing is queued on the board." in Simple. */
export function emptyQueueText(advanced: boolean): string {
  return advanced ? 'The planner queue is empty.' : 'Nothing is queued on the board.';
}
