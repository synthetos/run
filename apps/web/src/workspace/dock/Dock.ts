/**
 * The dock under the Job view's preview: a tab strip (from registry.ts) with the open file's summary, and one pane
 * per tab. Only offered tabs get a button; every registered pane stays mounted and is hidden unless shown.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PreviewParts } from '../../preview/PreviewPanel.ts';
import type { WorkspaceModel } from '../model.ts';
import { uiLevel } from '../jobWorkflow.ts';
import { fileSummary } from '../lineWords.ts';
import type { DockContext, DockTab } from './dockTab.ts';
import type { StopHooks } from '../views/JobStatusCard.ts';
import { dockTabRequest, dockTabs } from './registry.ts';
import { DOCK_MIN_PX, VIEWER_MIN_PX, clampDock, dockMax, loadDockHeight, saveDockHeight, terminalHeight } from './dockSize.ts';
import { DockResizer } from './DockResizer.ts';

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

export function Dock({ parts, model, stops = {} }: { readonly parts: PreviewParts; readonly model: WorkspaceModel | null; readonly stops?: StopHooks }): ComponentChild {
  const all = dockTabs();
  const [tab, setTab] = useState<string>(all[0]?.id ?? 'gcode');
  const ctx: DockContext = { parts, model, advanced: uiLevel.value.value === 'advanced', stops };
  const result = parts.state.status === 'ready' ? parts.state.result : null;
  const offered = all.filter((t) => t.available(ctx));
  // Another part of the page asked for a tab (registry.ts): show it when offered, then clear the request.
  const request = dockTabRequest.value;
  useEffect(() => {
    if (request === null) return;
    if (offered.some((t) => t.id === request)) setTab(request);
    dockTabRequest.value = null;
  }, [request]);
  // The panel's height: the user's (remembered), else the Terminal's opening share of the Job view, else the stylesheet's.
  const dock = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [userHeight, setUserHeight] = useState<number | null>(() => loadDockHeight());
  const [viewPx, setViewPx] = useState(0);
  const [cssPx, setCssPx] = useState(0);
  // On a laptop the 3D view and the panel share the column: the panel may take what the view has above its minimum.
  const [fitPx, setFitPx] = useState(Number.POSITIVE_INFINITY);
  useLayoutEffect(() => {
    const view = dock.current?.closest('.job-view') ?? null;
    const measure = (): void => {
      const wide = (globalThis.innerWidth ?? 0) > 650;
      // On a phone the page scrolls: the share is of the window, not of the scrolling Job view.
      setViewPx(wide ? (view?.clientHeight ?? globalThis.innerHeight ?? 0) : (globalThis.innerHeight ?? 0));
      const p = panel.current;
      const d = dock.current;
      if (p === null || d === null) return;
      const ph = p.getBoundingClientRect().height;
      if (p.style.height === '') setCssPx(ph);
      const column = d.closest('.canvas-column');
      const viewer = column?.querySelector('.viewer') ?? null;
      if (!wide || column === null || viewer === null) {
        setFitPx(Number.POSITIVE_INFINITY);
        return;
      }
      // What the column holds besides the 3D view and the dock (the timeline), from its content height, so the fit is
      // the same whatever the split is now, even while the column overflows.
      const dh = d.getBoundingClientRect().height;
      const rest = column.scrollHeight - viewer.getBoundingClientRect().height - dh;
      setFitPx(Math.max(DOCK_MIN_PX, Math.round(column.clientHeight - rest - (dh - ph) - VIEWER_MIN_PX)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined' || view === null) return;
    const watch = new ResizeObserver(measure);
    watch.observe(view);
    return () => watch.disconnect();
  }, []);
  const max = Math.min(dockMax(viewPx), fitPx);
  const wanted = viewPx === 0 ? null : userHeight !== null ? userHeight : tab === 'terminal' ? Math.max(terminalHeight(viewPx), cssPx) : null;
  const height = wanted === null ? null : Math.min(clampDock(wanted, viewPx), max);
  const resize = (px: number): void => {
    const next = Math.min(clampDock(px, viewPx === 0 ? globalThis.innerHeight : viewPx), max);
    setUserHeight(next);
    saveDockHeight(next);
  };
  return h(
    'div',
    { class: 'dock', 'data-dock-tab': tab, ref: dock, ...(height === null ? {} : { 'data-dock-sized': '' }) },
    h(DockResizer, { height: height ?? cssPx, max, onResize: resize }),
    h(
      'div',
      { class: 'dock-tabs', role: 'tablist', 'aria-label': 'File and machine' },
      offered.map((t) => h(TabButton, { key: t.id, tab: t, ctx, selected: tab === t.id, onSelect: () => setTab(t.id) })),
      h('span', { class: 'dock-summary' }, result === null ? 'No file open' : fileSummary(result.fileLines, result.sourceLines.length)),
    ),
    h(
      'div',
      { tabindex: 0, class: 'dock-panel', ref: panel, ...(height === null ? {} : { style: { height: `${height}px`, flex: 'none' } }) },
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
