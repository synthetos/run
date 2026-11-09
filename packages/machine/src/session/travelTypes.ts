/** The travel check's result (OD-24; travelCheck.ts). Kept apart so the session types can name it without a cycle. */

/** The first move past travel on an axis whose position is not known, for C41's words (owner, 2026-11-09). */
export interface TravelPast {
  readonly axis: 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C';
  /** The machine coordinate the move would reach, and the limit it passes (mm, or degrees on A, B and C). */
  readonly reach: number;
  readonly limit: number;
  readonly unit: 'mm' | '°';
  /** How many more moves (a line and an axis each) leave the travel after this one. */
  readonly more: number;
}

export interface TravelFinding {
  /** `outside`: a move leaves the travel; `unchecked`: a limit or a position was not read. */
  readonly kind: 'outside' | 'unchecked';
  readonly line: number | null;
  readonly text: string;
  /** On a move past travel with the position not known (the C40 finding), the first such move and how many follow. */
  readonly past?: TravelPast;
}

export interface TravelCheck {
  /** A move past travel with the position known: the job is blocked. */
  readonly block: TravelFinding | null;
  /** What the user must confirm before Start (C40): a move past travel with the position not known, or what could not be checked. */
  readonly confirm: TravelFinding | null;
}
