/**
 * The 3D view's explanatory notes, as notes in the Notes tab (owner, 2026-11-09): the scene's notes (machine position
 * not set, work zero versus the plan, the stock overhanging the fixture), a cut below the stock, and lines the stock
 * carving skipped. They no longer sit over the drawing; the key keeps a small "N notes" pill. Pure apart from reading
 * the carve progress signal.
 */
import type { Note } from '../workspace/notes/notes.ts';
import { belowText } from './CarveKey.ts';
import { STOCK_OFF_BED, STOCK_OFF_FIXTURE, STOCK_OVERHANGS, UNSET_NOTE, UNTRUSTED_NOTE, Z_NOTE_START } from './livePlacement.ts';

const FOOTPRINT = new Set([STOCK_OFF_BED, STOCK_OFF_FIXTURE, STOCK_OVERHANGS]);
import type { SceneKeyProps } from './SceneKey.ts';

/** A sentence's first clause as a title, the rest as its body: "A: b." → { title: "A.", body: "B." }. */
export function splitNote(text: string): { readonly title: string; readonly body: string } {
  const colon = text.indexOf(': ');
  const stop = text.indexOf('. ');
  const at = colon > 0 && (stop < 0 || colon < stop) ? colon : stop;
  if (at <= 0) return { title: text, body: '' };
  const title = `${text.slice(0, at).replace(/\.$/, '')}.`;
  const rest = text.slice(at + 2).trim();
  return { title, body: rest.length === 0 ? '' : `${rest.charAt(0).toUpperCase()}${rest.slice(1)}` };
}

export function previewNotes(key: SceneKeyProps | null): readonly Note[] {
  if (key === null) return [];
  const out: Note[] = [];
  (key.scene?.notes ?? []).forEach((text) => {
    // The machine position not set (or not trusted): one sentence and Home, the full text behind More.
    if (text === UNSET_NOTE || text === UNTRUSTED_NOTE) {
      const title = text === UNSET_NOTE ? 'Machine position not set.' : 'Machine position not trusted.';
      out.push({ id: `scene/${title}`, topic: 'Preview', title, body: 'The job is drawn as planned, not where the machine is.', detail: text, tone: 'warn', link: { kind: 'action', action: 'home', label: 'Home' } });
      return;
    }
    // The Z difference is part of the work zero note (one note, owner 2026-11-09): "… from where you planned it (Z 18.4 mm lower)".
    if (text.startsWith(Z_NOTE_START)) return;
    if (FOOTPRINT.has(text)) {
      out.push({ id: `scene/${text}`, topic: 'Preview', title: text, body: '', tone: 'warn', link: { kind: 'step', step: 'place', label: 'Place job' } });
      return;
    }
    const { title, body } = splitNote(text);
    out.push({ id: `scene/${title}`, topic: 'Preview', title, body, tone: 'warn' });
  });
  const note = key.tool?.note ?? null;
  if (note !== null && note !== undefined) out.push({ id: 'tool-note', topic: 'Preview', title: key.tool?.missing == null ? 'The first tool is a placeholder.' : `T${String(key.tool.missing)} isn’t in your tool table.`, body: note, link: { kind: 'view', view: 'tools', label: 'Tools' } });
  const carve = key.carve ?? null;
  const below = carve === null ? null : carve.status.value.below;
  if (below !== null && below !== undefined) {
    out.push({ id: 'below-stock', topic: 'Preview', title: 'The tool goes below the stock.', body: `First at line ${below.firstLine.toLocaleString('en-US')}.`, detail: `${belowText(below)}.`, tone: 'warn', link: { kind: 'line', line: below.firstLine } });
    // Only where it matters (owner, 2026-11-09): a cut below the stock on a bed whose top height nobody entered.
    if (key.scene?.bedPlaceholder === true) out.push({ id: 'bed-height', topic: 'Preview', title: 'Bed height not set.', body: 'Set it in Machines to check for cuts into the bed.', link: { kind: 'view', view: 'machines', label: 'Machines → Bed' } });
  }
  (carve?.uncarved ?? []).forEach((text, i) => out.push({ id: `carve/${String(i)}`, topic: 'Preview', title: 'Lines not carved.', body: text, tone: 'warn' }));
  return out;
}
