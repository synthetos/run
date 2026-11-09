/** The travel check's result (OD-24; travelCheck.ts). Kept apart so the session types can name it without a cycle. */

export interface TravelFinding {
  /** `outside`: a move leaves the travel; `unchecked`: a limit or a position was not read. */
  readonly kind: 'outside' | 'unchecked';
  readonly line: number | null;
  readonly text: string;
}

export interface TravelCheck {
  /** A move past travel with the position known: the job is blocked. */
  readonly block: TravelFinding | null;
  /** What the user must confirm before Start (C40): a move past travel with the position not known, or what could not be checked. */
  readonly confirm: TravelFinding | null;
}
