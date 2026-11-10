/**
 * The dock under the Job view's preview: a tab strip (from registry.ts) with the open file's summary, and one pane
 * per tab. Only offered tabs get a button; every registered pane stays mounted and is hidden unless shown.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { PreviewParts } from '../../preview/PreviewPanel.ts';
import type { WorkspaceModel } from '../model.ts';
import { uiLevel } from '../jobWorkflow.ts';
import { fileSummary } from '../lineWords.ts';
import type { DockContext, DockTab } from './dockTab.ts';
import { dockTabRequest, dockTabs } from './registry.ts';

function TabButton({ tab, ctx, selected, onSelect }: { readonly tab: DockTab; readonly ctx: DockContext; readonly selected: boolean; readonly onSelect: () => void }): ComponentChild {
  const badge = tab.badge?.(ctx) ?? null;
  const { id } = tab;
  return h(
    'button',
    { type: 'button', role: 'tab', id: `dock-tab-${id}`, 'aria-selected': selected ? 'true' : 'false', 'aria-controls': `dock-pane-${id}`, 'data-tab': id, onClick: onSelect },
    tab.label,
    badge === null ? null : h('span', { class: 'dock-badge', 'data-dock-badge': id }, ` (${badge})`),
    tab.dot === undefined ? null : h('span', { class: `live-dot${tab.dot(ctx) ? ' on' : ''}`, 'aria-hidden': 'true' }),
  );
}

export function Dock({ parts, model }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null }): ComponentChild {
  const all = dockTabs();
  const [tab, setTab] = useState<string>(all[0]?.id ?? 'gcode');
  const ctx: DockContext = { parts, model, advanced: uiLevel.value.value === 'advanced' };
  const result = parts.state.status === 'ready' ? parts.state.result : null;
  const offered = all.filter((t) => t.available(ctx));
  // Another part of the page asked for a tab (registry.ts): show it when offered, then clear the request.
  const request = dockTabRequest.value;
  useEffect(() => {
    if (request === null) return;
    if (offered.some((t) => t.id === request)) setTab(request);
    dockTabRequest.value = null;
  }, [request]);
  return h(
    'div',
    { class: 'dock', 'data-dock-tab': tab },
    h(
      'div',
      { class: 'dock-tabs', role: 'tablist', 'aria-label': 'File and machine' },
      offered.map((t) => h(TabButton, { key: t.id, tab: t, ctx, selected: tab === t.id, onSelect: () => setTab(t.id) })),
      h('span', { class: 'dock-summary' }, result === null ? 'No file open' : fileSummary(result.fileLines, result.sourceLines.length)),
    ),
    h(
      'div',
      { tabindex: 0, class: 'dock-panel' },
      all.map((t) =>
        h(
          'div',
          { key: t.id, tabindex: 0, class: t.paneClass === undefined ? 'dock-pane' : `dock-pane ${t.paneClass}`, role: 'tabpanel', id: `dock-pane-${t.id}`, 'aria-labelledby': `dock-tab-${t.id}`, hidden: tab !== t.id },
          h(t.Pane, { ctx, active: tab === t.id }),
        ),
      ),
    ),
  );
}
