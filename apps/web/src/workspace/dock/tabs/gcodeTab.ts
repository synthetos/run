/** The dock's G-code tab: the open file's lines (the preview's line list), each with its safety verdict. */
import { h, type ComponentChild } from 'preact';
import type { DockContext, DockTab } from '../dockTab.ts';

function GcodePane({ ctx }: { readonly ctx: DockContext; readonly active: boolean }): ComponentChild {
  return ctx.parts.slots.list ?? h('p', { class: 'live-empty' }, 'Open a file to see its lines here, each with its safety verdict.');
}

export const gcodeTab: DockTab = {
  id: 'gcode',
  label: 'G-code',
  available: () => true,
  Pane: GcodePane,
};
