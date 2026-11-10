/**
 * The terminal's scrollback (H91): every line the user sent, each reply, error, status report and note, timestamped,
 * newest last, at most `max` kept. Filters hide status reports or show the raw JSON instead of words. Every typed
 * line is kept here (and in the wire log, by the worker), sent or refused.
 *
 * Pure: a transcript is an immutable value; `append` returns a new one.
 */

/**
 * `sent`: a line the user entered (what went to the board, or the button it pressed); `reply`: the board's answer in
 * words; `error`: a refusal or a failure; `status`: a status report; `note`: run's own words (the first-move notice,
 * a move's result).
 */
export type EntryKind = 'sent' | 'reply' | 'error' | 'status' | 'note';

export interface Entry {
  readonly id: number;
  readonly at: number;
  readonly kind: EntryKind;
  readonly text: string;
  /** The raw line, when it differs from the words (a JSON reply or report). */
  readonly raw?: string;
}

export interface Transcript {
  readonly entries: readonly Entry[];
  readonly nextId: number;
}

export const TRANSCRIPT_MAX = 2000;

export const EMPTY_TRANSCRIPT: Transcript = Object.freeze({ entries: Object.freeze([]), nextId: 1 });

/** The transcript with one entry added; the oldest go first past `max`. */
export function append(t: Transcript, entry: Omit<Entry, 'id'>, max = TRANSCRIPT_MAX): Transcript {
  const added: Entry = { ...entry, id: t.nextId };
  const entries = [...t.entries, added];
  return { entries: entries.length > max ? entries.slice(entries.length - max) : entries, nextId: t.nextId + 1 };
}

export interface TranscriptFilter {
  /** Hide status reports. */
  readonly hideStatus: boolean;
  /** Show the raw line instead of the words where there is one. */
  readonly raw: boolean;
}

export const DEFAULT_FILTER: TranscriptFilter = Object.freeze({ hideStatus: true, raw: false });

/** The entries to show under `filter`, each with the text to show. */
export function visible(t: Transcript, filter: TranscriptFilter): readonly Entry[] {
  return t.entries.filter((e) => !(filter.hideStatus && e.kind === 'status')).map((e) => (filter.raw && e.raw !== undefined ? { ...e, text: e.raw } : e));
}

/** The time of an entry as the transcript shows it: `HH:MM:SS` in local time. */
export function timeOf(at: number): string {
  const d = new Date(at);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** The transcript as plain text, one entry per line, for copying. */
export function asText(t: Transcript, filter: TranscriptFilter): string {
  return visible(t, filter)
    .map((e) => `${timeOf(e.at)} ${e.kind.padEnd(6)} ${e.text}`)
    .join('\n');
}
