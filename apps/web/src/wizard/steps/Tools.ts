/**
 * Step 5 (spec §6.3, amended by OD-42: the wizard sets up the machine, not the job, so there is no stock here).
 * The chosen tool, "Add from catalog" (the catalog as a whole page over the wizard, CatalogPage.ts) and "Create a
 * tool" (the existing tool editor, above the frame). The state lives in module signals the mount owns; the view is
 * pure.
 */
import { signal } from '@preact/signals';
import { h, type ComponentChild } from 'preact';
import type { ToolEntry } from '../../workspace/library.ts';
import { toolDisplayName } from '../../workspace/tools/displayName.ts';

export const TOOLS_TITLE = 'Tools';
export const TOOLS_LEAD = 'One tool is enough to run the demo.';
export const TOOLS_TEXT = 'Pick a bit from the Onsrud catalog, or enter its diameter, flutes and length.';

/** The tool list when the catalog page opened, or null while it is closed; a tool added since closes it. */
export const catalogFrom = signal<readonly ToolEntry[] | null>(null);

/** Closes the catalog page and puts focus back on "Add from catalog" once the frame is live again (review minor 11). */
export function closeCatalog(): void {
  catalogFrom.value = null;
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-action="wizard-catalog"]')?.focus());
}
export const creatingTool = signal(false);
/** The tool list when the step opened; the tool added since is the chosen one (toolChoice.ts newToolSince). */
export const toolsBefore = signal<readonly ToolEntry[] | null>(null);

export interface ToolsProps {
  readonly tool: ToolEntry | null;
  readonly onCatalog: () => void;
  readonly onCreate: () => void;
}

export function Tools(p: ToolsProps): ComponentChild {
  return h(
    'div',
    { class: 'wizard-tools' },
    h('p', { class: 'wizard-line' }, TOOLS_TEXT),
    p.tool === null ? null : h('p', { class: 'wizard-headline', 'data-wizard': 'tool' }, h('strong', null, `T${p.tool.number} · ${toolDisplayName(p.tool.tool)}`)),
    h(
      'div',
      { class: 'wizard-actions' },
      h('button', { type: 'button', class: 'primary', 'data-action': 'wizard-catalog', onClick: p.onCatalog }, 'Add from catalog'),
      h('button', { type: 'button', 'data-action': 'wizard-create-tool', onClick: p.onCreate }, 'Create a tool'),
    ),
  );
}
