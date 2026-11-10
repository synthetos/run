/**
 * The dock's Terminal tab (H91, OD-31): the terminal beside the worker's wire transcript (3:1). Offered in Simple and
 * Advanced. It replaces the Console tab; every typed line takes its button's path (terminal/TerminalView.ts).
 */
import { h, type ComponentChild } from 'preact';
import { WireTranscript } from '../../../machine-ui/WireTranscript.ts';
import { TerminalView } from '../../../terminal/TerminalView.ts';
import type { DockContext, DockTab } from '../dockTab.ts';

function TerminalPane({ ctx, active }: { readonly ctx: DockContext; readonly active: boolean }): ComponentChild {
  return h('div', { class: 'console-pane' }, h(TerminalView, { model: ctx.model, stops: ctx.stops, advanced: ctx.advanced }), h(WireTranscript, { model: ctx.model, active }));
}

export const terminalTab: DockTab = {
  id: 'terminal',
  label: 'Terminal',
  available: () => true,
  Pane: TerminalPane,
};
