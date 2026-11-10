/**
 * The shape of one tab in the Job view's dock (the strip under the preview). Each tab says when it is offered, what
 * it shows, and an optional count or dot after its label. Presentation only; no machine access here.
 */
import type { ComponentChild } from 'preact';
import type { PreviewParts } from '../../preview/PreviewPanel.ts';
import type { WorkspaceModel } from '../model.ts';
import type { StopHooks } from '../views/JobStatusCard.ts';

/** What every tab sees when the dock renders. */
export interface DockContext {
  readonly parts: PreviewParts;
  readonly model: WorkspaceModel | null;
  /** The interface level is Advanced. */
  readonly advanced: boolean;
  /** The page's real Pause and Stop job (the strip's buttons and Escape), for the terminal's `!` and `%` (H91). */
  readonly stops: StopHooks;
}

export interface DockTab {
  /** Used in ids (`dock-tab-<id>`, `dock-pane-<id>`) and `data-tab`. */
  readonly id: string;
  readonly label: string;
  /** Extra class on the pane after `dock-pane` (today only the Live job pane's `live`). */
  readonly paneClass?: string;
  /** A count shown after the label as ` (n)`; null for none. */
  badge?(ctx: DockContext): string | number | null;
  /** Whether the tab's button is offered. Its pane stays mounted, hidden, either way (as before the registry). */
  available(ctx: DockContext): boolean;
  /** The pane's content. `active` is true while this tab is the one shown. */
  readonly Pane: (props: { readonly ctx: DockContext; readonly active: boolean }) => ComponentChild;
  /** A dot after the label, lit when this returns true; no dot when absent. */
  dot?(ctx: DockContext): boolean;
}
