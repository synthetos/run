/**
 * What sits over the 3D drawing (owner, 2026-11-09: "the viewer shows the picture, explanations go in Notes, and
 * actions go in modals or one menu"): one small bar with the viewer's settings menu (ViewerMenu.ts), a "Not homed" (or
 * "Not trusted") chip while the machine position is not established, and an "N notes" pill that opens the Notes tab;
 * under it the compact colour legend (SceneKey.ts). The live position is in the Position panel, not here. With no
 * file open, the prompt to open one leads the stack; Play preview's notice stays in view (OD-25).
 */
import { h, type ComponentChild } from 'preact';
import { SceneKey, type SceneKeyProps } from './SceneKey.ts';
import { ViewerMenu } from './ViewerMenu.ts';
import { UNSET_NOTE, UNTRUSTED_NOTE } from './livePlacement.ts';
import { openDockTab } from '../workspace/dock/dockRequest.ts';
import { previewNotes } from './previewNotes.ts';
import { NotesPill } from '../workspace/notes/NotesPill.ts';
import { bitTurns } from './bitTurns.ts';
import { usePublishNotes } from '../workspace/notes/usePublishNotes.ts';


export interface ViewerOverlayProps {
  /** The scene key's props, or null when there is no key (a lite file, nothing to show). */
  readonly sceneKey: SceneKeyProps | null;
  /** The prompt to open a file, or null: with no file open it leads the stack, so nothing covers its buttons. */
  readonly prompt?: ComponentChild;
  /** A notice that must stay in view (Play preview's, OD-25), outside the part that scrolls. */
  readonly notice?: ComponentChild;
}

/** The chip's word while the machine position is not established: the drawing shows the plan, not the machine. */
export function positionChip(key: SceneKeyProps | null): string | null {
  const notes = key?.scene?.notes ?? [];
  if (notes.includes(UNSET_NOTE)) return 'Not homed';
  if (notes.includes(UNTRUSTED_NOTE)) return 'Not trusted';
  return null;
}

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The bar's live chips (owner, 2026-11-10): "Planner starved" when the planner ran dry for over half a second
 * while the job runs; where the bit does not turn (reduced motion, or a software renderer), "↻ Spindle on" (or ↺
 * for M4).
 */
export function liveChips(key: SceneKeyProps | null, still: boolean): ComponentChild[] {
  const out: ComponentChild[] = [];
  if (key?.starved === true || key?.feedDiagnosis != null) out.push(h('span', { key: 'starved', class: 'viewer-chip', role: 'status', 'data-preview': 'starved-chip', title: key?.feedDiagnosis ?? 'The board ran short of lines to plan: it slows down. The job is still running.' }, key?.feedDiagnosis ?? 'Planner starved'));
  const spin = key?.spin ?? 0;
  if (still && spin !== 0) out.push(h('span', { key: 'spin', class: 'viewer-chip quiet', 'data-preview': 'spin-badge', title: spin === 1 ? 'The spindle is on, clockwise (M3)' : 'The spindle is on, counter-clockwise (M4)' }, `${spin === 1 ? '↻' : '↺'} Spindle on`));
  return out;
}

export function ViewerOverlay({ sceneKey, prompt = null, notice = null }: ViewerOverlayProps): ComponentChild {
  // The drawing's notes go to the Notes tab; the bar keeps a small "N notes" pill that opens it.
  usePublishNotes('preview', previewNotes(sceneKey));
  if (sceneKey === null && prompt === null && notice === null) return null;
  const chip = positionChip(sceneKey);
  return h(
    'div',
    { class: `viewer-overlay${prompt === null ? '' : ' has-prompt'}`, 'data-preview': 'overlay' },
    prompt === null ? null : h('div', { class: 'viewer-file-prompt' }, prompt),
    h(
      'div',
      { class: 'viewer-overlay-scroll' },

      sceneKey === null
        ? null
        : h(
            'div',
            { class: 'viewer-overlay-bar' },
            h(ViewerMenu, { scene: sceneKey.scene, carve: sceneKey.carve ?? null, simple: sceneKey.simple === true, ...(sceneKey.onOpen === undefined ? {} : { onOpen: sceneKey.onOpen }) }),
            chip === null ? null : h('button', { type: 'button', class: 'small viewer-chip', 'data-preview': 'position-chip', title: 'Why: in Notes', onClick: () => openDockTab('notes') }, chip),
            ...liveChips(sceneKey, reducedMotion() || !bitTurns.value),
            h(NotesPill, { topic: 'Preview' }),
          ),
      sceneKey === null ? null : h(SceneKey, sceneKey),
    ),
    notice,
  );
}
