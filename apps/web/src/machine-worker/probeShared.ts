/**
 * Probe Z's shared view and limits for the page (SAFETY §4.5c, H90). The page reaches the machine package only
 * through this folder (T-S39); these are the session's published shapes and its pure limits, nothing that writes.
 */
export { PROBE_LIMITS, probeStopMm } from '@synthetos/machine';
export type { ProbeBlock, ProbeInputReading, ProbeOutcome, ProbePlan, ProbeSnapshot, ProbeStep, ProbeTouch } from '@synthetos/machine';
