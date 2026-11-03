/** Display-only advisor mapping. No machine commands or Start decisions live here. */
import { KIND, parseLine } from '@synthetos/gcode';
import { planOperation, predictAchievableFeed, type AdvisorContext, type MachineCaps, type OperationKind, type OperationPlan, type Point3 } from '@synthetos/advisor';
import type { Material } from '@synthetos/library';
import type { PreviewResult } from '../gcode-worker/pipeline.ts';
import { latin1 } from '../gcode-worker/lines.ts';
import type { MachineProfile, ToolEntry } from './library.ts';

export type AdvisorFields = Readonly<Record<string, string>>;
export interface FileOperation {
  readonly id: string;
  readonly name: string;
  readonly tool: number | null;
  readonly feed: number | null;
  readonly rpm: number | null;
  readonly line: number;
  readonly paths: readonly (readonly Point3[])[];
}
export interface AdvisorFile {
  readonly operations: readonly FileOperation[];
  readonly problem: string | null;
}

/** Only lines accepted by the preview contribute. Geometry is the sanitised interpreter's output.
 * Each distinct feed/speed within an operation gets its own comparison, including plunges.
 * Rapids, uncertain geometry, changes of feed and operation boundaries break the estimate's path.
 */
export function advisorFile(result: PreviewResult): AdvisorFile {
  if (result.bytes.length > 16 * 1024 * 1024 || result.fileLines > 400_000) return { operations: [], problem: 'Advisor analysis is limited to 16 MB and 400,000 lines.' };
  const lines = Array.from({ length: result.fileLines }, (_, i) => latin1(result.bytes.subarray(result.spans[2 * i], result.spans[2 * i + 1])));
  const accepted = new Set(result.sourceLines);
  // Never describe a partial/uncertain path as the whole operation's estimate.
  const estimateGeometry = result.segments !== null && result.segments.kinds.length <= 10_000 && !result.segments.lineMarks.some((mark) => (mark & 2) !== 0) && !result.segments.kinds.some((kind) => (kind & KIND.UNCERTAIN) !== 0);
  type Mutable = Omit<FileOperation, 'paths'> & { paths: Point3[][] };
  const groups = new Map<string, Mutable>();
  let unit = 1;
  let feed: number | null = null;
  let rpm: number | null = null;
  let tool: number | null = null;
  let pendingTool: number | null = null;
  let name = 'Whole file';
  let operation = 0;
  let sent = 0;
  let previous: Mutable | null = null;
  let lastVertex = -1;
  let motion = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const heading = /^\s*\(\d{1,3}\s+([^()-]+?)(?:\s*-[^)]*)?\)\s*$/.exec(lines[i] ?? '');
    if (heading !== null) { name = (heading[1] ?? 'Operation').trim(); operation++; previous = null; }
    if (!accepted.has(line)) continue;
    const parsed = parseLine(lines[i] ?? '', line);
    if (parsed.errors.length > 0) { previous = null; continue; }
    const words = parsed.words;
    if (words.some((w) => w.letter === 'G' && w.value === 20)) unit = 25.4;
    if (words.some((w) => w.letter === 'G' && w.value === 21)) unit = 1;
    for (const w of words) {
      if (w.letter === 'F') feed = w.value * unit;
      if (w.letter === 'S') rpm = w.value;
      if (w.letter === 'T') pendingTool = w.value;
      if (w.letter === 'G' && [0, 1, 2, 3].includes(w.value)) motion = w.value;
    }
    if (words.some((w) => w.letter === 'M' && w.value === 6)) { tool = pendingTool; operation++; previous = null; }
    const consumesAxes = words.some((w) => w.letter === 'G' && [10, 28, 28.1, 28.2, 28.3, 30, 30.1, 92, 92.1, 92.2, 92.3].includes(w.value));
    const cutting = !consumesAxes && motion !== 0 && words.some((w) => 'XYZIJKR'.includes(w.letter));
    const key = `${operation}:${tool}:${feed}:${rpm}`;
    let group = groups.get(key);
    if (cutting && group === undefined) {
      group = { id: key, name, tool, feed, rpm, line, paths: [] };
      groups.set(key, group);
      if (groups.size > 200) return { operations: [], problem: 'This file has more than 200 distinct operation/feed/speed combinations. Analyze a smaller section.' };
    }
    const geo = result.segments;
    while (sent < result.sourceLines.length && (result.sourceLines[sent] ?? 0) < line) sent++;
    while (sent < result.sourceLines.length && result.sourceLines[sent] === line) {
      if (geo !== null && estimateGeometry) {
        const from = geo.lineToVertex[sent] ?? 0;
        const to = geo.lineToVertex[sent + 1] ?? from;
        for (let v = from; v < to; v++) {
          const kind = geo.kinds[v];
          if (!cutting || group === undefined || v === 0 || (kind !== KIND.FEED && kind !== KIND.ARC)) { previous = null; continue; }
          const point = (j: number): Point3 => [geo.vertices[j * 3] ?? 0, geo.vertices[j * 3 + 1] ?? 0, geo.vertices[j * 3 + 2] ?? 0];
          if (previous !== group || lastVertex !== v - 1) group.paths.push([point(v - 1)]);
          group.paths[group.paths.length - 1]?.push(point(v));
          previous = group;
          lastVertex = v;
        }
      }
      sent++;
    }
    if (!cutting) previous = null;
    if (words.some((w) => w.letter === 'M' && (w.value === 2 || w.value === 30))) break;
  }
  return { operations: [...groups.values()], problem: result.summary.blocked ? 'The file has blocking findings. Resolve them in Run before using advisor results.' : null };
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
  readonly achievable: number | null;
}

export function advisorRow(operation: FileOperation, fields: AdvisorFields, machine: MachineCaps | null, stock: Material | null, tools: readonly ToolEntry[], fileProblem: string | null, machineProblem: string | null): AdvisorRow {
  const empty = (problem: string): AdvisorRow => ({ operation, context: null, plan: null, problem, achievable: null });
  if (fileProblem !== null) return empty(fileProblem);
  if (machine === null) return empty(machineProblem ?? 'Complete the machine inputs.');
  if (stock === null) return empty('Choose a stock material in Setup.');
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
  let length = 0;
  let seconds = 0;
  if (plan.ok && machine.motion !== undefined) for (const path of operation.paths) {
    const estimate = predictAchievableFeed(path, operation.feed, machine.motion);
    if (estimate.ok) { length += estimate.value.lengthMm; seconds += estimate.value.seconds; }
  }
  return { operation, context: plan.ok ? context : null, plan, problem: plan.ok ? null : plan.message, achievable: seconds > 0 ? length / seconds * 60 : null };
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
