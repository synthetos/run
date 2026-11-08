/**
 * What sits over the 3D drawing, in one stack (first-time walk 2026-11-08, B4 and C18): the scene's key (its notes,
 * the tool, the bed, the carving; SceneKey.ts) and the live position readout. They used to be placed one by one, so
 * at laptop size the notes ran over the readout and out of their box, and the key covered half the drawing.
 *
 * Now they stack in the drawing's lower left, each wrapping inside its own box, and the stack scrolls rather than
 * grow over the toolbar. The key can be hidden (remembered in this browser, `preview.key.open`); hidden, a count of
 * its notes stays in view, in the warning colour, so a note is never silently out of sight. The readout always shows.
 * With no file open, the prompt to open one leads the stack.
 */
import { h, type ComponentChild } from 'preact';
import { stored } from '../workspace/storage.ts';
import { SceneKey, type SceneKeyProps } from './SceneKey.ts';

/** Whether the key is shown, per viewer (this browser). */
export const keyOpen = stored<boolean>('preview.key.open', true, (v): v is boolean => typeof v === 'boolean');

/** "1 note" / "2 notes". */
export function notesCount(n: number): string {
  return `${n} ${n === 1 ? 'note' : 'notes'}`;
}

/** Every note the key shows, in the warning colour: the scene's, the tool's, a cut below the stock, lines not carved. */
export function keyNotes(key: SceneKeyProps | null): number {
  if (key === null) return 0;
  const carve = key.carve ?? null;
  return (key.scene?.notes?.length ?? 0) + (key.tool?.note == null ? 0 : 1) + (carve !== null && carve.status.value.below !== null ? 1 : 0) + (carve?.uncarved.length ?? 0);
}

export interface ViewerOverlayProps {
  /** The scene key's props, or null when there is no key (a lite file, nothing to show). */
  readonly sceneKey: SceneKeyProps | null;
  /** The live readout, or null when not connected. */
  readonly readout: ComponentChild;
  /** The prompt to open a file, or null: with no file open it leads the stack, so nothing covers its buttons. */
  readonly prompt?: ComponentChild;
}

export function ViewerOverlay({ sceneKey, readout, prompt = null }: ViewerOverlayProps): ComponentChild {
  const open = keyOpen.value.value;
  const notes = keyNotes(sceneKey);
  if (sceneKey === null && readout === null && prompt === null) return null;
  return h(
    'div',
    { class: 'viewer-overlay', 'data-preview': 'overlay', 'data-key-open': open ? 'true' : 'false' },
    // The prompt and the key scroll when the drawing is short; the readout under them always shows.
    h(
      'div',
      { class: 'viewer-overlay-scroll' },
      prompt,
      sceneKey === null
        ? null
        : h(
            'div',
            { class: 'viewer-overlay-bar' },
            h('button', { type: 'button', class: 'small key-toggle', 'data-action': 'key-toggle', 'aria-expanded': open ? 'true' : 'false', onClick: () => keyOpen.set(!open) }, open ? 'Hide key' : 'Show key'),
            !open && notes > 0 ? h('button', { type: 'button', class: 'small key-notes-count', 'data-preview': 'key-notes-count', onClick: () => keyOpen.set(true) }, notesCount(notes)) : null,
          ),
      sceneKey !== null && open ? h(SceneKey, sceneKey) : null,
    ),
    readout,
  );
}
