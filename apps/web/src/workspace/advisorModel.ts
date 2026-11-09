/**
 * Display-only cutting-advice mapping (docs/design/ANALYZE.md slice 1). No machine commands or Start decisions live
 * here. The operations come from the job analysis report (the interpreter's event tape): this module never reads the
 * file's modal state itself, so there is one interpretation of the program, not two.
 */
import { planOperation, type AdvisorContext, type FeedRegime, type MachineCaps, type OperationKind, type OperationPlan, type OperationSummary } from '@synthetos/advisor';
import type { Material } from '@synthetos/library';
import type { PreviewResult } from '../gcode-worker/pipeline.ts';
import type { MachineProfile, ToolEntry } from './library.ts';

export type AdvisorFields = Readonly<Record<string, string>>;
export interface FileOperation {
  readonly id: string;
  readonly name: string;
  readonly tool: number | null;
  /** The cutting regime's programmed feed and speed: what the advice compares. */
  readonly feed: number | null;
  readonly rpm: number | null;
  readonly line: number;
  /** The whole operation, with its plunge, ramp and cut regimes. */
  readonly summary: OperationSummary;
}
export interface AdvisorFile {
  readonly operations: readonly FileOperation[];
  readonly problem: string | null;
}

/** The regime the advice compares: the cut with the most distance, else the longest regime. */
export function cuttingRegime(op: OperationSummary): FeedRegime | null {
  let best: FeedRegime | null = null;
  for (const r of op.regimes) {
    const better = best === null || (r.kind === 'cut' && best.kind !== 'cut') || ((r.kind === 'cut') === (best.kind === 'cut') && r.mm > best.mm);
    if (better) best = r;
  }
  return best;
}

/** One entry per CAM operation of the report: never one per feed (a plunge is a regime of its operation). */
export function advisorFile(result: PreviewResult): AdvisorFile {
  const operations = result.analysis.operations.map((op) => {
    const main = cuttingRegime(op);
    return { id: op.id, name: op.name, tool: op.tool, feed: main?.feed ?? null, rpm: main?.spindle ?? null, line: op.fromLine, summary: op };
  });
  return { operations, problem: result.summary.blocked ? 'The file has blocking findings. Resolve them in Job before using cutting advice.' : null };
}

const positive = (s: string | undefined): number | null => s !== undefined && s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) > 0 ? Number(s) : null;
const nonnegative = (s: string | undefined): number | null => s !== undefined && s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0 ? Number(s) : null;

/** Missing profile fields are explicit user inputs, keyed by that profile, never inferred from its name. */
export function advisorMachine(profile: MachineProfile | null, fields: AdvisorFields): { machine: MachineCaps | null; problem: string | null } {
  const missing = (problem: string): { machine: null; problem: string } => ({ machine: null, problem });
  if (profile === null) return missing('Select a machine in Machines.');
  const frameClass = fields['frame'];
  if (frameClass !== 'hobby' && frameClass !== 'medium' && frameClass !== 'rigid') return missing('Choose the machine’s frame class.');
  const kind = fields['spindle'];
  if (kind !== 'vfd' && kind !== 'pwm' && kind !== 'dial-router') return missing('Choose the spindle control type.');
  const minRpm = nonnegative(fields['minRpm']);
  const maxRpm = positive(fields['maxRpm']);
  const powerKw = positive(fields['powerKw']);
  if (minRpm === null || maxRpm === null || powerKw === null || minRpm > maxRpm) return missing('Enter a valid spindle range and rated power.');
  const x = profile.axes?.x?.maxFeed;
  const y = profile.axes?.y?.maxFeed;
  const z = profile.axes?.z?.maxFeed;
  const xy = x !== undefined && y !== undefined ? Math.min(x, y) : positive(fields['xy']);
  const zFeed = z ?? positive(fields['z']);
  if (xy === null || zFeed === null || !Number.isFinite(xy) || !Number.isFinite(zFeed) || xy <= 0 || zFeed <= 0) return missing('Enter maximum XY and Z feeds, or set them in the machine profile.');
  const dial = (fields['dial'] ?? '').split(',').filter((v) => v.trim() !== '').map((pair) => {
    const [setting, speed] = pair.split('=');
    return { setting: setting?.trim() ?? '', rpm: Number(speed) };
  });
  if (kind === 'dial-router' && (dial.length === 0 || dial.some((d) => d.setting === '' || !Number.isFinite(d.rpm) || d.rpm < minRpm || d.rpm > maxRpm || d.rpm <= 0) || new Set(dial.map((d) => d.setting)).size !== dial.length)) return missing('Enter the router’s dial table as setting=rpm pairs within its speed range.');
  const accel = positive(fields['accel']);
  const junctionDeviation = nonnegative(fields['junction']);
  const drive = profile.drive === 'belt' || profile.drive === 'rack' ? profile.drive : undefined;
  return { problem: null, machine: {
    frameClass, spindle: { kind, minRpm, maxRpm, powerKw, sControlled: kind !== 'dial-router', ...(kind === 'dial-router' ? { dial } : {}) }, maxFeed: { xy, z: zFeed },
    ...(accel !== null && junctionDeviation !== null ? { motion: { accel, junctionDeviation } } : {}),
    ...(drive === undefined ? {} : { drive: { x: drive, y: drive, z: drive } }),
  } };
}

export interface AdvisorRow {
  readonly operation: FileOperation;
  readonly context: AdvisorContext | null;
  readonly plan: OperationPlan | null;
  readonly problem: string | null;
}

export function advisorRow(operation: FileOperation, fields: AdvisorFields, machine: MachineCaps | null, stock: Material | null, tools: readonly ToolEntry[], fileProblem: string | null, machineProblem: string | null): AdvisorRow {
  const empty = (problem: string): AdvisorRow => ({ operation, context: null, plan: null, problem });
  if (fileProblem !== null) return empty(fileProblem);
  if (stock === null) return empty('Choose a stock material in Setup.');
  if (machine === null) return empty(machineProblem ?? 'Complete the machine inputs.');
  const tool = tools.find((t) => t.number === (operation.tool ?? positive(fields['tool'])));
  if (tool === undefined) return empty(operation.tool === null ? 'Select the tool already in the spindle.' : `Add T${operation.tool} to the tool library.`);
  const kind = fields['kind'];
  if (!['slot', 'pocket', 'adaptive', 'profile', 'finish', 'drill', 'v-carve'].includes(kind ?? '')) return empty('Choose the operation type.');
  const ap = positive(fields['ap']);
  const ae = positive(fields['ae']);
  if (ap === null || ae === null) return empty('Enter depth of cut and stepover from the CAM setup.');
  const coolant = fields['coolant'];
  if (coolant !== 'none' && coolant !== 'air' && coolant !== 'mist' && coolant !== 'flood') return empty('Choose the coolant available for this operation.');
  if (operation.feed === null || operation.rpm === null || operation.feed <= 0 || operation.rpm <= 0) return empty('The file needs explicit positive feed and spindle speed for comparison.');
  const context: AdvisorContext = { machine, tool: tool.tool, material: stock, coolant, operation: { id: operation.id, kind: kind as OperationKind, ap, ae, programmed: { feed: operation.feed, rpm: operation.rpm } } };
  const plan = planOperation(context);
  return { operation, context: plan.ok ? context : null, plan, problem: plan.ok ? null : plan.message };
}

export function advisorCheck(rows: readonly AdvisorRow[]): string {
  if (rows.length === 0) return 'Feeds: open a cutting file to check';
  if (rows.some((r) => r.problem !== null || r.plan === null)) return 'Feeds: needs review in Analyze';
  const plans = rows.map((r) => r.plan).filter((p): p is Extract<OperationPlan, { ok: true }> => p?.ok === true);
  const placeholder = plans.some((p) => p.provenance.placeholder) ? ' (placeholder data; not advice)' : '';
  const verdict = plans.some((p) => p.comparison?.verdict === 'too-aggressive') ? 'too aggressive'
    : plans.some((p) => p.comparison?.verdict === 'rubbing') ? 'risk of rubbing'
    : plans.some((p) => p.comparison?.verdict !== 'within') ? 'needs review' : 'within range';
  return `Feeds: ${verdict}${placeholder}`;
}
