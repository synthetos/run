/**
 * The Analyze view's state (docs/design/ANALYZE.md slice 1): the open file's motion report, the inputs that time it,
 * and the link from a region to the toolpath and its lines in Job. Display only: nothing here reaches the board,
 * changes the file or gates Start.
 *
 * Freshness: the report is part of the preview result it was computed with, so it can never be shown for another
 * file. A region link carries that result too, and the Job preview ignores a link made for a file it no longer shows.
 */
import { computed, signal } from '@preact/signals';
import { motionTime, type Estimate, type MotionTime, type PlannerProfile, type ProgramReport } from '@synthetos/advisor';
import type { PreviewResult } from '../gcode-worker/pipeline.ts';
import { axisSettings, boardReading, motionInputs, savedReading, type AxisSetting, type BoardReading, type InputSources } from './analysisInputs.ts';
import { viewRequest } from './boardNavigation.ts';
import { currentFile, type OpenFile } from './fileBridge.ts';
import { selectedMachine } from './library.ts';
import type { LiveView } from './model.ts';

export const programReport = computed<ProgramReport | null>(() => currentFile.value?.preview?.analysis ?? null);

/** Keeps the connected board's reading for later ("Last read …"), writing only when it changed. */
export function rememberReading(r: BoardReading | null): void {
  if (r === null) return;
  const saved = savedReading.value.value;
  const same = saved !== null && JSON.stringify({ ...saved, at: 0 }) === JSON.stringify({ ...r, at: 0 });
  if (!same) savedReading.set(r);
}

export function inputSources(view: LiveView | null, now: number): InputSources {
  return { live: boardReading(view, now), saved: savedReading.value.value, profile: selectedMachine.value };
}

export interface MotionView {
  readonly report: ProgramReport;
  readonly time: MotionTime;
  readonly settings: readonly AxisSetting[];
}

export function motionView(report: ProgramReport, sources: InputSources): MotionView {
  return { report, time: motionTime(report, motionInputs(sources)), settings: axisSettings(sources) };
}

/**
 * A request from Analyze to show something in Job: the preview scrubs to `sent` (1-based) and, with `range`, draws
 * those sent lines highlighted on the toolpath. Applied only while the preview still shows `preview`.
 */
export interface ScrubRequest {
  readonly preview: PreviewResult;
  readonly sent: number;
  /** Sent-line indexes, inclusive, to highlight on the toolpath; null to show a line only. */
  readonly range: { readonly from: number; readonly to: number } | null;
  readonly seq: number;
}

export const scrubRequest = signal<ScrubRequest | null>(null);
let seq = 0;

function request(sent: number, range: ScrubRequest['range']): void {
  const preview = currentFile.value?.preview;
  if (preview === undefined) return;
  scrubRequest.value = { preview, sent: sent + 1, range, seq: ++seq };
  viewRequest.value = 'run';
}

/** "Show on toolpath": Job, with sent lines `from`..`to` highlighted in 3D and the list at the first. */
export function showOnToolpath(from: number, to: number): void {
  request(from, { from, to });
}

/** "Go to line …": Job, with the G-code list at that line (`sent` is its sent-line index). */
export function goToLine(sent: number): void {
  request(sent, null);
}

/**
 * The firmware time model's estimate for the open file on this machine (docs/design/ANALYZE.md slice 2), computed in
 * the G-code worker. Kept with the preview and the settings it was made for: a late answer for another file, or for
 * settings that changed since, is never shown.
 */
export interface PlanEstimate {
  readonly preview: PreviewResult;
  readonly key: string;
  readonly estimate: Estimate | null;
}

export const planEstimate = signal<PlanEstimate | null>(null);

/** Asks the worker for the estimate of the open file with `profile`, unless the one held already matches. */
export function requestEstimate(file: OpenFile | null, profile: PlannerProfile | null): void {
  const preview = file?.preview;
  if (preview === undefined || profile === null || file?.estimate === undefined) return;
  const key = JSON.stringify(profile);
  const held = planEstimate.value;
  if (held !== null && held.preview === preview && held.key === key) return;
  planEstimate.value = { preview, key, estimate: null };
  void file.estimate(profile).then((estimate) => {
    const now = planEstimate.value;
    if (now !== null && now.preview === preview && now.key === key) planEstimate.value = { preview, key, estimate };
  });
}

/** The estimate for this file and these settings, or null (none asked, still running, or for something else). */
export function estimateFor(preview: PreviewResult | undefined, profile: PlannerProfile | null): Estimate | null {
  const held = planEstimate.value;
  return preview === undefined || profile === null || held === null || held.preview !== preview || held.key !== JSON.stringify(profile) ? null : held.estimate;
}

