/**
 * Typo help for the terminal (H91): an unknown word gets "`gt0x10` isn't a command or setting on this board. Did you
 * mean `g0x10`?". A typed move one character away is tried first (a slip of the finger in G-code), then the nearest
 * setting this board can read. No allowlist words reach the user.
 *
 * Pure.
 */
import { parseTypedLine } from '@synthetos/safety';
import { normaliseGcode } from '../console/translate.ts';

export interface TypoRefusal {
  readonly kind: 'refused';
  readonly reason: string;
  readonly remedy: string;
}

/** The edit distance between two short strings (insert, delete, replace, swap of neighbours). */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((d[i - 1] as number[])[j] as number + 1, (d[i] as number[])[j - 1] as number + 1, (d[i - 1] as number[])[j - 1] as number + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, (d[i - 2] as number[])[j - 2] as number + 1);
      (d[i] as number[])[j] = v;
    }
  }
  return (d[a.length] as number[])[b.length] as number;
}

/** A typed move one character away from `text` (one character left out, or two neighbours swapped), or null. */
export function nearMove(text: string): string | null {
  const tries: string[] = [];
  for (let i = 0; i < text.length; i++) tries.push(text.slice(0, i) + text.slice(i + 1));
  for (let i = 0; i + 1 < text.length; i++) tries.push(text.slice(0, i) + (text[i + 1] as string) + (text[i] as string) + text.slice(i + 2));
  for (const t of tries) {
    const code = normaliseGcode(t);
    if (code !== null && /^G/.test(code) && parseTypedLine(code).ok) return t;
  }
  return null;
}

/** The setting nearest to `token` among `readable`, at most 2 edits away and never for a word of one letter. */
export function nearSetting(token: string, readable: readonly string[]): string | null {
  if (token.length < 2) return null;
  let best: { readonly name: string; readonly d: number } | null = null;
  for (const name of readable) {
    const d = distance(token, name);
    if (d <= 2 && (best === null || d < best.d || (d === best.d && name < best.name))) best = { name, d };
  }
  return best?.name ?? null;
}

/** The refusal for an unknown word, with the closest thing the user may have meant. */
export function typoHelp(text: string, token: string, readable: readonly string[]): TypoRefusal {
  const reason = `\`${text}\` isn't a command or setting on this board.`;
  const guess = nearMove(text) ?? nearSetting(token, readable);
  return { kind: 'refused', reason, remedy: guess === null ? 'Press Tab to see what is.' : `Did you mean \`${guess}\`?` };
}
