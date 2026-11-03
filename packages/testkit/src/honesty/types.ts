/**
 * The honesty rule (RUN_PLAN §8.1, OLD-TP §7): every model behaviour a safety
 * claim depends on carries a citation and a status.
 *
 * - `verified-source`: read in the firmware source at the pinned commit; the
 *   citation says where. Not yet seen on a board.
 * - `verified-bench`: also confirmed on a bench run; the bench record says so.
 * - `UNVERIFIED`: neither; `bench` names the PROTOCOL_NOTES §15 task that
 *   closes it. The release checklist requires each to be bench-verified or
 *   covered by a mitigation that does not depend on it.
 */

import '../marker.ts';
export type BehaviourStatus = 'verified-source' | 'verified-bench' | 'UNVERIFIED';

/** Pinned sources (vendor/firmware-pins.json): EN = edge-next 93a723b8, TG = master d0418390 (440.21). */
export type CitationSource = 'EN' | 'TG' | 'EN-HIL';

export interface Citation {
  readonly src: CitationSource;
  /** `firmware/tinyg/`-relative for EN and TG; repository-relative (`tests/hil/...`) for EN-HIL. */
  readonly file: string;
  /** First and last line, inclusive. */
  readonly lines: readonly [number, number];
  /**
   * Text that must appear within those lines at the pinned commit. The local
   * citation check (`test/citations.test.ts`, run with RUN_FIRMWARE_REPO set)
   * fails when a re-pin moves the code.
   */
  readonly quote: string;
}

export type ModelId = 'tinyg-en' | 'tinyg-440';

export interface Behaviour {
  /** Stable id, referenced by `@behaviour <id>` in the model source and by at least one test title. */
  readonly id: string;
  readonly model: ModelId;
  readonly summary: string;
  readonly status: BehaviourStatus;
  readonly cites: readonly Citation[];
  /** Bench task (PROTOCOL_NOTES §15) for UNVERIFIED behaviours, or the open question for verified ones. */
  readonly bench?: string;
  /** Firmware issue ids (E0xx) the behaviour reproduces or depends on. */
  readonly issues?: readonly string[];
}

/** A simplification of the model that no safety claim may rest on. */
export interface ModelLimit {
  readonly id: string;
  readonly scope: ModelId | 'both' | 'link';
  readonly summary: string;
}
