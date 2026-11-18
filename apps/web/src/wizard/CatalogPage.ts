/**
 * The tool catalog as a whole page over the wizard (owner, 2026-11-18, picture 147): the catalog's own layout at
 * the full viewport, with "Back to setup" above it. The person picks a tool and adds it; the mount sees the new
 * tool (Tools.ts catalogFrom), closes this page and step 5 shows the choice. It renders inside the wizard's dialog
 * (WizardFrame `overlay`), so focus stays in the wizard and the catalog's own dialogs sit above it.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { ToolCatalog } from '../workspace/views/tools/ToolCatalog.ts';

export const CATALOG_BACK = 'Back to setup';
export const CATALOG_HINT = 'Add a tool and setup continues with it.';

export function CatalogPage(p: { readonly onBack: () => void }): ComponentChild {
  const back = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { back.current?.focus(); }, []);
  return h(
    'div',
    { class: 'wizard-catalog', role: 'region', 'aria-label': 'Tool catalog' },
    h(
      'div',
      { class: 'wizard-catalog-bar' },
      h('button', { type: 'button', ref: back, 'data-action': 'wizard-catalog-back', onClick: p.onBack }, CATALOG_BACK),
      h('p', { class: 'wizard-line' }, CATALOG_HINT),
    ),
    h('div', { class: 'wizard-catalog-body' }, h(ToolCatalog, { active: true })),
  );
}
