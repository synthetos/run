/**
 * From a part of the scene to its settings: a click on the bed, fixture, stock or a clamp (in the 3D
 * drawing, the top view or the key's links) opens the job step that edits it, scrolls to its section and
 * focuses its heading. Navigation only: nothing here reaches the machine.
 */
import { jobStep, type JobStep } from '../workspace/jobWorkflow.ts';

export type ScenePart = 'bed' | 'fixture' | 'stock' | 'clamp';

interface PartInfo {
  /** The part's name, as the hover label says it. */
  readonly name: string;
  /** What its settings are called, for the key's link. */
  readonly settings: string;
  readonly step: JobStep;
  /** The heading to scroll to and focus. */
  readonly heading: string;
}

export const SCENE_PARTS: Readonly<Record<ScenePart, PartInfo>> = Object.freeze({
  bed: { name: 'Bed', settings: 'Bed settings', step: 'machine', heading: '[data-setup-section="bed"] h2' },
  fixture: { name: 'Fixture', settings: 'Fixture settings', step: 'stock', heading: '[data-setup-section="fixture"] h2' },
  stock: { name: 'Stock', settings: 'Stock settings', step: 'stock', heading: '[data-setup-section="stock"] h2' },
  clamp: { name: 'Clamp', settings: 'Stock & workholding', step: 'stock', heading: '[data-job-panel="stock"] > h2' },
});

/** The part a solid's tag names, or null for anything else. */
export function scenePart(tag: string | null | undefined): ScenePart | null {
  return tag === 'bed' || tag === 'fixture' || tag === 'stock' || tag === 'clamp' ? tag : null;
}

/** "Fixture: open settings"; a clamp opens stock & workholding. */
export function pickLabel(part: ScenePart): string {
  return part === 'clamp' ? 'Clamp: open stock & workholding' : `${SCENE_PARTS[part].name}: open settings`;
}

/**
 * Opens a part's settings: the Job view (`onView`), the step that edits it, then, once drawn, its section
 * scrolled into view and its heading focused.
 */
export function openSceneSettings(part: ScenePart, onView: (view: string) => void, doc: Document = document): void {
  const info = SCENE_PARTS[part];
  onView('job');
  jobStep.value = info.step;
  const reveal = (): void => {
    const heading = doc.querySelector<HTMLElement>(info.heading);
    if (heading === null) return;
    const details = heading.closest('details');
    if (details !== null) details.open = true;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.scrollIntoView({ block: 'start' });
    heading.focus({ preventScroll: true });
  };
  // The step's panel is unhidden on the next render.
  requestAnimationFrame(() => requestAnimationFrame(reveal));
}
