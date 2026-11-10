/**
 * What sits over the 3D drawing, in one stack (first-time walk 2026-11-08, B4 and C18): the scene's key (its notes,
 * the tool, the bed, the carving; SceneKey.ts) and the live position readout. They used to be placed one by one, so
 * at laptop size the notes ran over the readout and out of their box, and the key covered half the drawing.
 *
 * Now they stack in the drawing's lower left, each wrapping inside its own box, and the stack scrolls rather than
 * grow over the toolbar. The key can be hidden (remembered in this browser, `preview.key.open`). The drawing's notes
 * are in the Notes tab (previewNotes.ts, owner 2026-11-09); a small "N notes" pill in the bar opens it, whether the key
 * is shown or not, so a note is never silently out of sight. The readout always shows.
 * With no file open, the prompt to open one leads the stack.
 */
import { h, type ComponentChild } from 'preact';
import { stored } from '../workspace/storage.ts';
import { SceneKey, type SceneKeyProps } from './SceneKey.ts';
import { previewNotes } from './previewNotes.ts';
import { NotesPill } from '../workspace/notes/NotesPill.ts';
import { usePublishNotes } from '../workspace/notes/usePublishNotes.ts';

/** Whether the key is shown, per viewer (this browser). */
export const keyOpen = stored<boolean>('preview.key.open', true, (v): v is boolean => typeof v === 'boolean');

export interface ViewerOverlayProps {
  /** The scene key's props, or null when there is no key (a lite file, nothing to show). */
  readonly sceneKey: SceneKeyProps | null;
  /** The live readout, or null when not connected. */
  readonly readout: ComponentChild;
  /** The prompt to open a file, or null: with no file open it leads the stack, so nothing covers its buttons. */
  readonly prompt?: ComponentChild;
  /** A notice that must stay in view (Play preview's, OD-25), above the readout, outside the part that scrolls. */
  readonly notice?: ComponentChild;
}

export function ViewerOverlay({ sceneKey, readout, prompt = null, notice = null }: ViewerOverlayProps): ComponentChild {
  const open = keyOpen.value.value;
  // The drawing's notes go to the Notes tab; the bar keeps a small "N notes" pill that opens it.
  usePublishNotes('preview', previewNotes(sceneKey));
  if (sceneKey === null && readout === null && prompt === null && notice === null) return null;
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
            h(NotesPill, { topic: 'Preview' }),
          ),
      sceneKey !== null && open ? h(SceneKey, sceneKey) : null,
    ),
    notice,
    readout,
  );
}
