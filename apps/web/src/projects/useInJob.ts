/**
 * "Use in Job" for a project file (FLOW_ANALYSIS §3 "File entry", §4 step
 * 3): a stored file gets an explicit role in the active job. G-code opens
 * through the job opener; a drawing (DXF, SVG) is read by the outline reader
 * with a units and scale check and a notice of what the reader left out,
 * shown before it is accepted as the job's fixture, the job's stock outline
 * or the machine's bed; anything else is kept as a reference. The stored file
 * and its hash are never changed; a photo never becomes scaled geometry.
 *
 * Pure except `applyImport`, which writes the active job or the machine.
 */
import { MAX_OUTLINE_BYTES, OutlineError, parseOutline, type ParsedOutline } from '../workspace/outline.ts';
import { saveMachineBed, type MachineProfile } from '../workspace/library.ts';
import { activeJob, illustrativeClamps, updateActiveJob, withMachine, withSetup, type Job } from '../workspace/jobModel.ts';
import { machineStore } from '../workspace/library.ts';
import type { ProjectFile } from './store.ts';
import { executionLock } from '../workspace/fileBridge.ts';
import { formatBytes, isGcodeFile } from './limits.ts';

export type JobRole = 'gcode' | 'stock' | 'fixture' | 'bed' | 'reference';

export const JOB_ROLE_LABEL: Readonly<Record<JobRole, string>> = { gcode: 'G-code: open in Job', stock: 'Stock outline', fixture: 'Fixture', bed: 'Bed drawing (saved to the machine)', reference: 'Reference file' };

/** The roles a stored file can take, from its name: drawings become geometry, G-code opens, the rest is reference. */
export function rolesFor(file: Pick<ProjectFile, 'name' | 'role'>): readonly JobRole[] {
  if (isGcodeFile(file)) return ['gcode', 'reference'];
  if (/\.(dxf|svg)$/i.test(file.name)) return ['fixture', 'stock', 'bed', 'reference'];
  return ['reference'];
}

export type Units = 'mm' | 'in';
export const MM_PER_IN = 25.4;

/** A drawing read and ready to accept, or why it could not be. */
export type ImportCheck =
  | { readonly ok: true; readonly parsed: ParsedOutline; readonly kind: 'dxf' | 'svg' }
  | { readonly ok: false; readonly reason: string };

/** Reads a drawing's text with the outline reader. The stored file is untouched whatever the outcome. */
export function checkDrawing(file: Pick<ProjectFile, 'name' | 'size'>, text: string): ImportCheck {
  if (file.size > MAX_OUTLINE_BYTES) return { ok: false, reason: `${file.name} is ${formatBytes(file.size)}; drawings up to ${formatBytes(MAX_OUTLINE_BYTES)} can be read here. The file stays in the project.` };
  try {
    return { ok: true, parsed: parseOutline(file.name, text), kind: /\.dxf$/i.test(file.name) ? 'dxf' : 'svg' };
  } catch (e) {
    return { ok: false, reason: `${e instanceof OutlineError ? e.message : 'The file could not be read as a drawing.'} The file stays in the project.` };
  }
}

/** The outline scaled from its drawing units into millimetres, with an extra factor. */
export function scaled(parsed: ParsedOutline, units: Units, scale: number): ParsedOutline {
  const k = (units === 'in' ? MM_PER_IN : 1) * scale;
  const r = (n: number): number => Math.round(n * k * 1000) / 1000;
  return { outline: parsed.outline.map(([x, y]) => [r(x), r(y)] as const), holes: parsed.holes.map(([x, y, rad]) => [r(x), r(y), r(rad)] as const), width: r(parsed.width), depth: r(parsed.depth), skipped: parsed.skipped };
}

/** "Not read: 3 SPLINE, 12 curves (drawn as straight chords)." or ''. */
export function skippedText(parsed: ParsedOutline): string {
  const parts = Object.entries(parsed.skipped).map(([k, n]) => (k === 'curves' ? `${n} curves (drawn as straight chords)` : `${n} ${k}`));
  return parts.length === 0 ? '' : `Not read: ${parts.join(', ')}.`;
}

export interface ImportOptions {
  readonly units: Units;
  readonly scale: number;
  /** The fixture's or bed's height/thickness, mm. */
  readonly height: number;
  /** For a bed: the machine Z of its top (where the front-left corner of its top sits below home). */
  readonly bedTopZ: number;
}

export type ApplyResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

/** Applies an accepted drawing to the active job (fixture, stock outline) or the job's machine (bed). */
export function applyImport(role: Exclude<JobRole, 'gcode' | 'reference'>, file: ProjectFile, check: Extract<ImportCheck, { ok: true }>, options: ImportOptions, machines: readonly MachineProfile[] = machineStore.value.value): ApplyResult {
  if (executionLock.value !== null) return { ok: false, reason: executionLock.value };
  const parsed = scaled(check.parsed, options.units, options.scale);
  const source = { file: file.name.slice(0, 120), kind: check.kind, hash: file.hash } as const;
  const at = new Date().toISOString();
  if (role === 'fixture') {
    const job = updateActiveJob((j) =>
      withSetup(j, {
        fixture: {
          id: `fixture.${file.hash.slice(0, 16)}`,
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Fixture',
          source,
          outline: parsed.outline,
          holes: parsed.holes,
          height: options.height,
          position: j.setup.fixture?.position ?? { x: parsed.width / 2, y: parsed.depth / 2 },
          material: j.setup.fixture?.material ?? 'Not recorded',
        },
      }),
    );
    return job === null ? { ok: false, reason: 'No job is open yet.' } : { ok: true, text: `${file.name} is the fixture of ${job.name}: ${Math.round(parsed.width)} × ${Math.round(parsed.depth)} mm, ${parsed.holes.length} holes, ${options.height} mm high.` };
  }
  if (role === 'stock') {
    const job = updateActiveJob((j: Job) => {
      const stock = { ...j.setup.stock, shape: 'sheet' as const, width: parsed.width, depth: parsed.depth, thickness: options.height };
      return withSetup(j, { stock, stockOutline: { outline: parsed.outline, holes: parsed.holes, source }, clamps: j.setup.clamps.length > 0 ? illustrativeClamps(stock) : [] });
    });
    return job === null ? { ok: false, reason: 'No job is open yet.' } : { ok: true, text: `${file.name} is the stock outline of ${job.name}: ${Math.round(parsed.width)} × ${Math.round(parsed.depth)} × ${options.height} mm.` };
  }
  const machineId = machines.find((m) => m.id === (activeJob.value?.machine?.id ?? ''))?.id ?? null;
  if (machineId === null) return { ok: false, reason: 'Choose a machine for this job first (Job → Machine): a bed drawing is saved to the machine as a bed revision.' };
  const bed = saveMachineBed(machineId, { width: parsed.width, depth: parsed.depth, thickness: options.height, outline: parsed.outline, holes: parsed.holes, toMachine: { x: 0, y: 0, z: options.bedTopZ }, source: { kind: 'drawing', file: file.name.slice(0, 120), hash: file.hash, units: options.units, scale: options.scale, at } });
  if (bed === null) return { ok: false, reason: 'The job’s machine no longer exists.' };
  const machine = machineStore.value.value.find((m) => m.id === machineId) ?? null;
  const job = updateActiveJob((j) => withMachine(j, machine));
  return { ok: true, text: `${file.name} is bed revision ${bed.revision} of ${machine?.name ?? 'the machine'}: ${Math.round(parsed.width)} × ${Math.round(parsed.depth)} mm, ${options.height} mm thick, top at machine Z ${options.bedTopZ}. Drawing holes replace any previous hole grid. ${job === null ? '' : `${job.name} now plans on it; other jobs keep their pinned revision.`}` };
}
