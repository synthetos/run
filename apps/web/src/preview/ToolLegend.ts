/**
 * The tool colours' legend in the scene's key (colour by tool; owner, 2026-11-09): one entry per tool the file
 * uses, in the order it uses them, each with its colour; a tool that is not known has the neutral colour and
 * says so. Shown when the file uses two or more tools (with one, its lines are simply that tool's colour).
 * Clicking an entry makes that tool's lines stand out; clicking it again shows them all. Tools are named as
 * the tool library names them, at both levels, like the rest of the key.
 */
import { h, type ComponentChild } from 'preact';
import type { Rgba } from '@synthetos/gcode-view';
import type { LegendEntry } from './toolSlots.ts';

export interface ToolLegendProps {
  readonly entries: readonly LegendEntry[];
  readonly palette: readonly Rgba[];
  readonly focus: number | null;
  readonly onFocus?: (slot: number | null) => void;
}

const rgb = (c: Rgba | undefined): string => (c === undefined ? 'currentColor' : `rgb(${String(Math.round(c[0] * 255))},${String(Math.round(c[1] * 255))},${String(Math.round(c[2] * 255))})`);

/** A short stroke in the tool's colour, as its lines are drawn. */
function Swatch({ color }: { readonly color: Rgba | undefined }): ComponentChild {
  return h('svg', { class: 'tool-swatch', viewBox: '0 0 16 8', 'aria-hidden': 'true' }, h('rect', { x: 0, y: 2, width: 16, height: 4, rx: 2, fill: rgb(color) }));
}

export function ToolLegend({ entries, palette, focus, onFocus }: ToolLegendProps): ComponentChild {
  if (entries.length < 2) return null;
  return h(
    'span',
    { class: 'tool-legend', role: 'group', 'aria-label': 'Tool colours', 'data-scene': 'tool-legend' },
    entries.map((e) => {
      const text = e.label;
      const content = [h(Swatch, { color: palette[e.slot] }), h('span', null, text)];
      const attrs = { key: `${String(e.number)}:${String(e.slot)}`, class: `tool-legend-entry${e.known ? '' : ' unknown'}`, 'data-tool-slot': String(e.slot), 'data-tool-number': e.number === null ? 'none' : String(e.number) };
      return onFocus === undefined
        ? h('span', attrs, content)
        : h('button', { ...attrs, type: 'button', 'aria-pressed': focus === e.slot ? 'true' : 'false', title: focus === e.slot ? 'Show all tools' : 'Show only this tool', onClick: () => onFocus(focus === e.slot ? null : e.slot) }, content);
    }),
  );
}
