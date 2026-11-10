/**
 * The carving part of the scene's key (docs/design/tool-sim.md, slices 2 and 3): one line saying the stock is
 * carved and at what cell size ("Carving at 0.25 mm"), the notes naming lines that are not carved because their
 * tool is unknown, and the note where the cut goes below the stock. It never says the job is safe. `data-carved-through`, `data-carve-cell` and
 * `data-carve-done` say how far the carve has got, for tests.
 */
import { h, type ComponentChild } from 'preact';
import type { Rgba } from '@synthetos/gcode-view';
import type { CarveInfo } from './useCarve.ts';

/** A cell size in plain millimetres: 0.25, 0.3, 1.25. */
export function cellText(cell: number): string {
  return `${String(Number(cell.toFixed(3)))} mm`;
}

/**
 * The key line's carving part: "Carving detail 0.25 mm" in Advanced; nothing visible in Simple unless the carve
 * stopped. It carries the test hooks at both levels. Reads the progress signal, so only this re-renders while the
 * carve runs.
 */
export function CarveLabel({ carve, simple = false }: { readonly carve: CarveInfo; readonly simple?: boolean }): ComponentChild {
  const s = carve.status.value;
  const text = s.failed !== null ? 'Carving stopped' : simple ? '' : `Carving detail ${cellText(carve.cell)}`;
  return h(
    'span',
    { 'data-scene': 'carve', 'data-carve-cell': String(carve.cell), 'data-carved-through': String(s.through), 'data-carve-done': s.done ? 'true' : 'false', 'data-carve-lowest': s.lowest.toFixed(3), ...(text === '' ? { hidden: true } : {}) },
    text,
  );
}

const rgb = (c: Rgba): string => `rgb(${String(Math.round(c[0] * 255))},${String(Math.round(c[1] * 255))},${String(Math.round(c[2] * 255))})`;

/** A small square in a surface's colour. */
function Patch({ fill }: { readonly fill: string }): ComponentChild {
  return h('svg', { class: 'carve-swatch', viewBox: '0 0 10 10', 'aria-hidden': 'true' }, h('rect', { x: 0.5, y: 0.5, width: 9, height: 9, rx: 2, style: { fill } }));
}

/**
 * The carve's legend (owner, 2026-11-09: "show cut-out sections in a different colour than the stock"): "Stock"
 * in the stock's colour and "Cut" in the cut colour, once something is cut; "Below stock" in the warning colour
 * when the cut goes below it. Reads the progress signal, so only this re-renders while the carve runs.
 */
export function CarveLegend({ carve, stock }: { readonly carve: CarveInfo; readonly stock: Rgba | null }): ComponentChild {
  const s = carve.status.value;
  if (s.failed !== null || !(s.lowest < carve.top - 0.01)) return null;
  const entry = (key: string, fill: string, text: string): ComponentChild => h('span', { key, class: 'tool-legend-entry', 'data-carve-legend': key }, h(Patch, { fill }), h('span', null, text));
  return h(
    'span',
    { class: 'tool-legend carve-legend', role: 'group', 'aria-label': 'Carved stock colours', 'data-scene': 'carve-legend' },
    stock === null ? null : entry('stock', rgb(stock), 'Stock'),
    entry('cut', 'var(--carve-cut)', 'Cut'),
    s.below === null ? null : entry('below', 'var(--danger)', 'Below stock'),
  );
}

/** A depth below the stock in plain millimetres: 0.6, 1.2, or 0.05 for a small one. */
export function depthText(mm: number): string {
  return `${mm >= 0.1 ? mm.toFixed(1) : mm.toFixed(2)} mm`;
}

/**
 * The below-stock note: where the carve first goes below the stock and how far, and the deepest point when it
 * is elsewhere. It reads the planned setup, so it says so; it never says safe or verified, and it gates nothing.
 */
export function belowText(below: NonNullable<CarveInfo['status']['value']['below']>): string {
  const first = `The tool goes ${depthText(below.firstDepth)} below the stock at line ${String(below.firstLine)}`;
  const deeper = below.deepestLine !== below.firstLine ? `, and ${depthText(below.deepestDepth)} below at line ${String(below.deepestLine)}` : '';
  return `${first}${deeper} (preview, from the planned setup)`;
}

