import {
  type Banner,
  type Classification,
  type Dialect,
  type Inbound,
  type JsonObject,
  type JsonValue,
  type ProbeResult,
  type Response,
  type StatusReport
} from '@synthetos/protocol';
import { type Decision, type MatrixSnapshot } from '@synthetos/safety';
import type { JobDeps } from '../job.ts';
import type { MotionDeps } from '../motion.ts';
import { type ReportStep } from '../reports.ts';
import {
  type Expected,
  type FaultCause,
  type FaultKind,
  type LiveState,
  type PendingRead,
  type ProbeProgress,
  type ReadPurpose,
  type ReportChange,
  type SessionConfig,
  type SessionEvent,
  type SessionIntent,
  type SessionState,
  type SettingWriteOutcome,
  type SettingWriteState,
  type TimerId,
  type Transition
} from '../types.ts';
import type { ReducerFeatures } from './features.ts';
import type { Tx } from './transaction.ts';
import type { createReducerValues } from './values.ts';
export type ReadValueLike = { readonly value: JsonValue | null; readonly status: number; } | undefined;
/** Per-instance lexical dependencies; no clock, port, or mutable module singleton. */
export interface ReducerDeps extends ReturnType<typeof createReducerValues> {
  readonly features: ReducerFeatures;
  readonly MOTION_DEPS: MotionDeps;
  readonly JOB_DEPS: JobDeps;
  initialState(): SessionState;
  dialectOf(state: SessionState): Dialect | null;
  matrixSnapshot(state: SessionState): MatrixSnapshot;
  readableNow(state: SessionState, token: string): boolean;
  enqAllowedNow(state: SessionState): boolean;
  enqByte(state: SessionState): number | undefined;
  reduce(config: SessionConfig, state: SessionState, event: SessionEvent): Transition;
  onJobLineDropped(t: Tx, index: number): void;
  linkUp(s: SessionState): boolean;
  deny(reason: string, remedy: string, citation: string): Decision;
  onIntent(t: Tx, request: SessionIntent, at: number): void;
  onEnq(t: Tx, matrix: Decision): void;
  writeEnq(t: Tx, byte: number): void;
  onRead(t: Tx, tokens: readonly string[], matrix: Decision): void;
  settingWriteActive(s: SessionState): boolean;
  onSettingsWrite(t: Tx, key: unknown, value: unknown, matrix: Decision): void;
  finishSettingWrite(t: Tx, outcome: SettingWriteOutcome, detail: string, patch?: Partial<SettingWriteState>): void;
  onGateAnswer(t: Tx, token: string, r: Response): void;
  onSettingAnswer(t: Tx, r: Response): void;
  onReadBackAnswer(t: Tx, r: Response, at: number): void;
  interruptSettingWrite(t: Tx, why: string): void;
  refuseBoot(t: Tx, why: string): void;
  onFlash(t: Tx, matrix: Decision): void;
  onBootGateAnswer(t: Tx, token: string, r: Response): void;
  onBootWritten(t: Tx, at: number): void;
  interruptBootEntry(t: Tx, why: string): void;
  onAckFault(t: Tx, matrix: Decision): void;
  writeFeedhold(t: Tx): void;
  resetToNotConnected(t: Tx, unknownOnNextConnect: boolean): void;
  onOpened(t: Tx): void;
  startProbe(t: Tx, restarts: number, banner: Banner | undefined, normalized?: boolean): void;
  onLineWritten(t: Tx, at: number): void;
  answerTimeout(t: Tx, purpose: ReadPurpose): number;
  onLinkLost(t: Tx, at: number): void;
  onTimer(t: Tx, id: TimerId, at: number): void;
  onInbound(t: Tx, raw: Inbound, at: number): void;
  onBanner(t: Tx, banner: Banner, at: number): void;
  onResponse(t: Tx, r: Response, at: number): void;
  isDataEntry(e: Expected): boolean;
  owedAnswers(s: SessionState): readonly Expected[];
  consumeOwed(t: Tx, owed: readonly Expected[], index: number, data: boolean): void;
  answers(e: Expected, r: Response): boolean;
  onAnswer(t: Tx, e: PendingRead, r: Response, at: number): void;
  advanceProbe(t: Tx, probe: ProbeProgress): void;
  finishProbe(t: Tx): void;
  probeRecord(result: ProbeResult, c: Classification): string;
  checkUnclassifiedResting(t: Tx): void;
  finishReading(t: Tx): void;
  onVerifyAnswer(t: Tx, token: string, value: number | undefined): void;
  refuseAck(t: Tx, why: string): void;
  onStatusReport(t: Tx, report: StatusReport, at: number): void;
  onGarbled(t: Tx, at: number): void;
  isObject(v: JsonValue | undefined): v is JsonObject;
  mergeLive(t: Tx, fields: JsonObject): void;
  withNumber(t: Tx, live: LiveState, key: string, v: number): LiveState;
  startSeed(t: Tx): void;
  isSeedOwed(s: SessionState): boolean;
  mergeStateValue(t: Tx, token: string, value: JsonValue | undefined): void;
  onSeedAnswer(t: Tx, e: PendingRead, r: Response, at: number): void;
  seedAnswered(t: Tx, e: PendingRead | null, at: number): void;
  maybeConfigure(t: Tx): void;
  reportStepText(step: ReportStep): string;
  failReports(t: Tx, why: string): void;
  nextReportStep(t: Tx, detail: string | null, skipReadback?: boolean): void;
  numberValue(v: ReadValueLike): number | undefined;
  addChange(t: Tx, change: ReportChange): void;
  onReportAnswer(t: Tx, r: Response, at: number): void;
  watchdogActive(s: SessionState): boolean;
  watchdogMs(t: Tx): number;
  syncWatchdog(t: Tx): void;
  enterStale(t: Tx, at: number): void;
  silentWhileBusy(s: SessionState): boolean;
  onWatchdog(t: Tx, at: number): void;
  askForLife(t: Tx): 'enq' | 'get';
  enterFault(t: Tx, cause: FaultCause, kind: FaultKind, detail: string, at: number): void;
  pump(t: Tx): void;
  lineFor(s: SessionState, read: PendingRead): string | undefined;
}
