/**
 * Provenance of a recommendation (MACHINING_ASSISTANT §1 principles 1 and 4).
 *
 * Every number the advisor computes comes from inputs, and every input is a
 * `Sourced` value. `InputLog` records each one as it is read; the resulting
 * `Provenance` lists the cited sources and the placeholder inputs, and
 * `placeholder` is true as soon as one input was a placeholder. A
 * recommendation computed from a placeholder can therefore never be shown
 * as advice without the flag.
 */
import { citationText, isPlaceholder, type SourceCitation, type Sourced } from '@synthetos/library';

export interface Provenance {
  readonly placeholder: boolean;
  /** The inputs that were placeholders, by name (`material.cutting.vc`). */
  readonly placeholderInputs: readonly string[];
  /** The cited sources, as one-line citations. */
  readonly sources: readonly string[];
}

export class InputLog {
  readonly #placeholders = new Set<string>();
  readonly #sources = new Set<string>();

  /** Reads a sourced input and records where it came from. */
  use<T>(name: string, input: Sourced<T>): T {
    if (isPlaceholder(input)) this.#placeholders.add(name);
    else this.#sources.add(citationText(input.source));
    return input.value;
  }

  /** Records a cited input that is not wrapped (a tool's own cutting data entry). */
  cite(source: SourceCitation): void {
    this.#sources.add(citationText(source));
  }

  result(): Provenance {
    const placeholderInputs = Object.freeze([...this.#placeholders].sort());
    return Object.freeze({ placeholder: placeholderInputs.length > 0, placeholderInputs, sources: Object.freeze([...this.#sources].sort()) });
  }
}
