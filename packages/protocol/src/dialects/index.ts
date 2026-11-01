/** Dialect data, lookups and the capability classifier (ROADMAP P0-08). */
export type {
  BannerShape,
  ByteWindowFlow,
  Dialect,
  DialectCaps,
  DialectFlow,
  DialectGcode,
  DialectId,
  DialectLimits,
  DialectPolls,
  DialectTransport,
  Family,
  FlowRules,
  FooterRev,
  DialectJobGcode,
  GcodeRule,
  LineWindowFlow,
  MachineClass,
  RealtimeByte,
  RealtimeBytes,
  RealtimeScope,
  StatEntry,
  StatusClass,
  StatusEntry,
  StopSequence,
  StopStep,
  UnverifiedFact,
  UsbIdentity,
} from './types.ts';
export { TINYG_EN } from './tinygEn.ts';
export { TINYG_440 } from './tinyg440.ts';
export { TINYG_449_STOCK } from './tinyg449Stock.ts';
export { G2CORE_EDGE } from './g2core.ts';
export { BYTE, READ_ONLY_STOP_JOB } from './shared.ts';
export {
  DIALECTS,
  checkFooterForDialect,
  dialectById,
  holdName,
  mapStat,
  resolveBufferFull,
  selectFlowEngine,
  statusClass,
  stopJobFor,
} from './lookup.ts';
export type { BufferFullEvidence, SessionMode } from './lookup.ts';
export { classify } from './classify.ts';
export type { Classification, ClassifyReason } from './classify.ts';
