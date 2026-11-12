import { toolMaterialLabel } from '../tools/labels.ts';
import { toolDisplayName } from '../tools/displayName.ts';
/**
 * The Advanced "Cutting" rows (owner, 2026-11-09): the active tool, the spindle speed, the feed, the chip load and the
 * surface speed, compared with the job's stock material. Pure: the view passes in the live readings, the tool table
 * and the material. When something is missing the rows say what, in one line, with what fixes it.
 */
import type { Material, Tool } from '@synthetos/library';
import { chipLoad, referenceFor, rubbingRisk, surfaceSpeedMpm, usesFullDiameterNote, verdict, type Range, type Reference, type Verdict } from './chipLoad.ts';

export const MM_PER_IN = 25.4;

export interface CuttingInput {
  /** `tool` as the board reports it; null when not reported. */
  readonly toolNumber: number | null;
  /**
   * The board's status list carries `tool` (run adds it, OD-34), so `toolNumber` follows M6 live. When it does not,
   * the value is the one read at connect and can be stale.
   */
  readonly toolLive: boolean;
  /** While a job runs: the T number in effect at the executing line, from the file (the 3D marker's tool). */
  readonly fileTool: number | null;
  readonly tools: readonly { readonly number: number | null; readonly tool: Tool }[];
  /** The job's stock material: its id, and the record when the library has it. Null id: no job or no material. */
  readonly materialId: string | null;
  readonly material: Material | null;
  /** `vel` and `feed` as reported, in the board's units per minute; `sps` (the commanded speed after the clamp). */
  readonly vel: number | null;
  readonly feed: number | null;
  readonly sps: number | null;
  /** `spe` (or `spc`) as reported: false while the spindle is off, null when not reported. */
  readonly spindleOn: boolean | null;
  /** The speed the job's file commands, when it commands one (the check's single speed); used when sps is not reported. */
  readonly fileSpeed: number | null;
  readonly inches: boolean;
}

/** A missing piece: one line, and what fixes it. */
export type Fix = { readonly kind: 'tool'; readonly number: number; readonly label: string } | { readonly kind: 'step'; readonly step: 'stock'; readonly label: string } | { readonly kind: 'view'; readonly view: 'materials'; readonly label: string };
export interface Missing {
  readonly text: string;
  readonly fix: Fix | null;
}

export interface CuttingRows {
  readonly tool: { readonly number: number; readonly name: string; readonly diameter: number; readonly flutes: number; readonly from: 'board' | 'file' } | null;
  readonly spindle: { readonly rpm: number; readonly from: 'board' | 'file' } | null;
  readonly feed: { readonly mmMin: number; readonly from: 'moving' | 'programmed' } | null;
  readonly chipLoad: { readonly value: number; readonly verdict: Verdict | null; readonly rubbing: boolean; readonly range: Range | null } | null;
  readonly surface: { readonly value: number; readonly reference: string | null } | null;
  readonly reference: Reference | null;
  readonly note: string | null;
  readonly missing: readonly Missing[];
}

const finite = (v: number | null): v is number => v !== null && Number.isFinite(v);

export function cuttingRows(i: CuttingInput): CuttingRows {
  const missing: Missing[] = [];
  const scale = i.inches ? MM_PER_IN : 1;
  // Feed: the live path velocity while moving, otherwise the programmed F the board reports.
  const feed = finite(i.vel) && i.vel > 0 ? { mmMin: i.vel * scale, from: 'moving' as const } : finite(i.feed) ? { mmMin: i.feed * scale, from: 'programmed' as const } : null;
  const spindle = i.spindleOn === false ? { rpm: 0, from: 'board' as const } : finite(i.sps) ? { rpm: i.sps, from: 'board' as const } : finite(i.fileSpeed) ? { rpm: i.fileSpeed, from: 'file' as const } : null;
  if (spindle === null) missing.push({ text: 'Spindle speed not known: the board does not report it.', fix: null });

  // The board's live tool wins; the file's only stands in, during a job, when the board does not report it.
  const fromFile = !(i.toolLive && i.toolNumber !== null) && i.fileTool !== null && i.fileTool > 0;
  const n = fromFile ? i.fileTool : i.toolNumber;
  const entry = n === null || n <= 0 ? undefined : i.tools.find((t) => t.number === n);
  if (n === null) missing.push({ text: 'The board has not reported a tool.', fix: null });
  else if (n <= 0) missing.push({ text: 'No tool chosen (T0).', fix: null });
  else if (entry === undefined) missing.push({ text: `Tool T${n} isn’t in your tool table.`, fix: { kind: 'tool', number: n, label: `Add T${n}` } });
  const t = entry?.tool ?? null;
  const tool = t === null || n === null ? null : { number: n, name: toolDisplayName(t), diameter: t.geometry.diameter, flutes: t.geometry.flutes, from: fromFile ? ('file' as const) : ('board' as const) };
  if (t !== null && n !== null && !(t.geometry.flutes > 0)) missing.push({ text: `T${n} has no flute count.`, fix: { kind: 'tool', number: n, label: `Edit T${n}` } });

  if (i.materialId === null) missing.push({ text: 'No material set for this job.', fix: { kind: 'step', step: 'stock', label: 'Stock & workholding' } });
  const reference = t === null || i.materialId === null ? null : referenceFor(t, i.materialId, i.material);
  if (t !== null && i.materialId !== null && reference === null) {
    missing.push({ text: `No chip-load data for ${toolMaterialLabel(t.toolMaterial)} in ${i.material?.name ?? 'this material'}.`, fix: { kind: 'view', view: 'materials', label: 'Materials' } });
  }

  const fz = t === null ? null : chipLoad(feed?.mmMin ?? null, spindle?.rpm ?? null, t.geometry.flutes);
  const vc = t === null ? null : surfaceSpeedMpm(t.geometry.diameter, spindle?.rpm ?? null);
  const vcReference = reference === null ? null : reference.from === 'tool' ? (reference.target.vc > 0 ? `tool data ${Math.round(reference.target.vc)} m/min` : null) : reference.vc === null ? null : `range ${Math.round(reference.vc.min)}–${Math.round(reference.vc.max)} m/min`;
  return {
    tool,
    spindle,
    feed,
    chipLoad: fz === null ? null : { value: fz, verdict: reference === null ? null : verdict(fz, reference.fz), rubbing: reference !== null && rubbingRisk(fz, reference), range: reference?.fz ?? null },
    surface: vc === null ? null : { value: vc, reference: vcReference },
    reference,
    note: t === null ? null : usesFullDiameterNote(t.type),
    missing,
  };
}
