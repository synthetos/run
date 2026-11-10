/**
 * Tab completion for the terminal (H91): G and M codes with a one-line meaning and what the terminal does with each,
 * and this board's settings with their words (console/words.ts). Completion only fills in text: what is entered is
 * classified like any typed line.
 *
 * Pure.
 */
import { suggest } from '../console/words.ts';

export interface Completion {
  /** The word as it is completed. */
  readonly text: string;
  /** One line: what it means. */
  readonly meaning: string;
}

/** The codes the terminal knows, each with its meaning in plain words. */
export const CODES: readonly Completion[] = Object.freeze([
  { text: 'G0', meaning: 'Rapid move' },
  { text: 'G1', meaning: 'Move at the feed (F)' },
  { text: 'G2', meaning: 'Arc, clockwise' },
  { text: 'G3', meaning: 'Arc, counter-clockwise' },
  { text: 'G4', meaning: 'Wait P seconds' },
  { text: 'G10', meaning: 'Set work zero here (L20, axes at 0)' },
  { text: 'G17', meaning: 'Arcs in the XY plane' },
  { text: 'G18', meaning: 'Arcs in the XZ plane' },
  { text: 'G19', meaning: 'Arcs in the YZ plane' },
  { text: 'G20', meaning: 'Inches' },
  { text: 'G21', meaning: 'Millimetres' },
  { text: 'G28.2', meaning: 'Home the axes named' },
  { text: 'G28.3', meaning: 'Set machine position 0 here' },
  { text: 'G53', meaning: 'Machine coordinates, this move only' },
  { text: 'G54', meaning: 'Work coordinate system 1' },
  { text: 'G55', meaning: 'Work coordinate system 2' },
  { text: 'G56', meaning: 'Work coordinate system 3' },
  { text: 'G57', meaning: 'Work coordinate system 4' },
  { text: 'G58', meaning: 'Work coordinate system 5' },
  { text: 'G59', meaning: 'Work coordinate system 6' },
  { text: 'G90', meaning: 'Absolute distances' },
  { text: 'G91', meaning: 'Relative distances' },
  { text: 'G92', meaning: 'Temporary offset: axes read 0 here' },
  { text: 'G92.1', meaning: 'Clear the temporary offset' },
  { text: 'M3', meaning: 'Spindle on, clockwise (S speed)' },
  { text: 'M4', meaning: 'Spindle on, counter-clockwise (S speed)' },
  { text: 'M5', meaning: 'Spindle off' },
  { text: 'M7', meaning: 'Mist coolant on' },
  { text: 'M8', meaning: 'Flood coolant on' },
  { text: 'M9', meaning: 'Coolant off' },
]);

/** The word at the end of `input` (after the last space), as typed. */
export function lastWord(input: string): string {
  const m = /(\S*)$/.exec(input);
  return (m?.[1] ?? '').trimStart();
}

/**
 * Completions for the word at the end of `input`: a G or M code word gets the codes it starts; anything else, alone
 * on the line, gets the settings this board can read. At most `max`.
 */
export function completions(input: string, dialect: string | null, max = 8): readonly Completion[] {
  const word = lastWord(input);
  if (/^[gm]\d*(\.\d*)?$/i.test(word)) {
    const upper = word.toUpperCase();
    return CODES.filter((c) => c.text.startsWith(upper)).slice(0, max);
  }
  if (input.trim() !== word || word === '') return [];
  return suggest(word, dialect, max).map((s) => ({ text: input.trimStart().startsWith('$') ? `$${s.token}` : s.token, meaning: s.label === '' ? s.description : s.label }));
}

/** `input` with its last word replaced by `completion`. */
export function applyCompletion(input: string, completion: Completion): string {
  const word = lastWord(input);
  return `${input.slice(0, input.length - word.length)}${completion.text}`;
}

/** The longest text every completion starts with (Tab with several choices fills in what they share). */
export function commonPrefix(list: readonly Completion[]): string {
  if (list.length === 0) return '';
  let prefix = (list[0] as Completion).text;
  for (const c of list) {
    while (!c.text.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}
