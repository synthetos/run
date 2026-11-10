/**
 * The 3D view's explanatory notes, as notes in the Notes tab (owner, 2026-11-09): the scene's notes (machine position
 * not set, work zero versus the plan, the stock overhanging the fixture), a cut below the stock, and lines the stock
 * carving skipped. They no longer sit over the drawing; the key keeps a small "N notes" pill. Pure apart from reading
 * the carve progress signal.
 */
import type { Note } from '../workspace/notes/notes.ts';
import { belowText } from './CarveKey.ts';
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
    const { title, body } = splitNote(text);
    out.push({ id: `scene:${title}`, topic: 'Preview', title, body, tone: 'warn' });
  });
  const carve = key.carve ?? null;
  const below = carve === null ? null : carve.status.value.below;
  if (below !== null && below !== undefined) out.push({ id: 'below-stock', topic: 'Preview', title: 'The tool goes below the stock.', body: `${belowText(below)}.`, tone: 'warn', link: { kind: 'line', line: below.firstLine } });
  (carve?.uncarved ?? []).forEach((text, i) => out.push({ id: `carve:${String(i)}`, topic: 'Preview', title: 'Lines not carved.', body: text, tone: 'warn' }));
  return out;
}
