/**
 * Numbers with sources (MACHINING_ASSISTANT §1 principle 4).
 *
 * Every built-in material and tool value names its source (a manufacturer
 * datasheet, a handbook, a Synthetos measurement) and its version, or is
 * marked as a placeholder. Nothing marked as a placeholder ships as advice:
 * whatever reads a `Sourced` value through `toAdvice` gets the flag with it,
 * and the advisor carries it into every recommendation computed from it.
 *
 * A value the user typed in is sourced too, as `{ kind: 'user' }`.
 */

export type SourceKind = 'manufacturer' | 'handbook' | 'synthetos' | 'user' | 'ai';

/** Where a number comes from. `version` is the datasheet revision or handbook edition. */
export interface SourceCitation {
  readonly kind: SourceKind;
  readonly title: string;
  readonly version?: string;
  /** Page, table or section within the source. */
  readonly locator?: string;
}

/** A value with a cited source. */
export interface CitedValue<T> {
  readonly value: T;
  readonly source: SourceCitation;
}

/** A value nobody has sourced yet. It is never advice on its own (§1 principle 4). */
export interface PlaceholderValue<T> {
  readonly value: T;
  readonly placeholder: true;
  /** Why it is a placeholder, or what it waits for. */
  readonly note?: string;
}

export type Sourced<T> = CitedValue<T> | PlaceholderValue<T>;

/** A value as it may be shown or used as advice: the placeholder flag always travels with it. */
export type Advice<T> =
  | { readonly value: T; readonly placeholder: false; readonly source: SourceCitation }
  | { readonly value: T; readonly placeholder: true; readonly note: string };

/** The note a placeholder carries when its record gives none. */
export const DEFAULT_PLACEHOLDER_NOTE = 'Placeholder value: no cited source yet.';

export function isPlaceholder<T>(v: Sourced<T>): v is PlaceholderValue<T> {
  return 'placeholder' in v;
}

/** The value with its provenance, never a bare number. */
export function toAdvice<T>(v: Sourced<T>): Advice<T> {
  if (isPlaceholder(v)) return Object.freeze({ value: v.value, placeholder: true, note: v.note ?? DEFAULT_PLACEHOLDER_NOTE });
  return Object.freeze({ value: v.value, placeholder: false, source: v.source });
}

/** A one-line citation: "Title, version, locator". */
export function citationText(source: SourceCitation): string {
  return [source.title, source.version, source.locator].filter((part) => part !== undefined).join(', ');
}

/** A value the user entered. */
export function userValue<T>(value: T): CitedValue<T> {
  return Object.freeze({ value, source: Object.freeze({ kind: 'user', title: 'Entered by the user' }) });
}
