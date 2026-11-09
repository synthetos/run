/**
 * Lines as the user counts them (first-time walk 2026-11-08, C5): file lines everywhere a line is named (the strip,
 * the job card, the G-code tab, the check), and when Run sends more lines than the file has, the check says how many
 * it adds and why, instead of a second, larger total.
 */

/** The G-code tab's summary: "28 lines, 26 with commands". */
export function fileSummary(fileLines: number, toSend: number): string {
  return `${fileLines.toLocaleString('en-US')} lines, ${toSend.toLocaleString('en-US')} with commands`;
}

/** "plus 8 lines Run adds (…)", or '' when Run adds none. `splits` is how many of the file's lines it splits. */
export function addedLinesText(total: number, toSend: number, splits: number): string {
  const added = total - toSend;
  if (added <= 0) return '';
  const why = splits > 0 ? 'it splits long moves into shorter ones and sets the units and modes' : 'it sets the units and modes and ends the job';
  return `plus ${added.toLocaleString('en-US')} ${added === 1 ? 'line' : 'lines'} Run adds (${why})`;
}

/** The check's sentence: the file's own lines first, then what Run adds. */
export function checkedText(total: number, toSend: number | null, splits: number): string {
  if (toSend === null) return `Checked with this board: ${total.toLocaleString('en-US')} lines to send`;
  const added = addedLinesText(total, toSend, splits);
  return `Checked with this board: the file’s ${toSend.toLocaleString('en-US')} lines with commands${added === '' ? '' : `, ${added}`}`;
}
