/**
 * @synthetos/safety
 *
 * Safety core: allow-matrix, sanitiser, preflight, jog plan, flash gate, fault policy, overrun bound and the canonical warning strings.
 *
 * This package has ZERO runtime npm dependencies and must never import
 * `contracts`, the cloud client, or any network API (RUN_PLAN §5.3).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

export * from './strings.ts';
export { BOARD_TEXT_MAX, boardText } from './boardText.ts';
export { CANNOT_GUARANTEE } from './contract.ts';
export * from './sanitize/index.ts';
export {
  BASE_STATES,
  CURRENT_RELEASE,
  INTENTS,
  OVERLAYS,
  PHASE_1_RELEASE,
  PHASE_2_RELEASE,
  PORT_OPEN_STATES,
  STOP_CLASS,
  allowed,
  intentKind,
  isLive,
} from './allowMatrix.ts';
export type { BaseState, Decision, Intent, IntentKind, MatrixSnapshot, Overlay, Release } from './allowMatrix.ts';
export { overrunBound } from './overrun.ts';
export { EMPTY_AXIS_MODE_SESSION, INHIBITED_JOINT_BEHAVIOUR, axisModeFacts } from './axisModeFacts.ts';
export type { AxisModeFact, AxisModeFactCode, AxisModeReading, AxisModeSession } from './axisModeFacts.ts';
export type { OverrunBound, QueuedLine } from './overrun.ts';
export { HOST_GATE_FIELDS, diffHostGates, effectiveHostGates, workEnvelope } from './hostGates.ts';
export type { C19Acceptance, DualMotorAxis, Envelope, HostGateChange, HostGateField, HostGates, SpindleKind } from './hostGates.ts';
