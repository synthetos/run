/**
 * Colour by tool as a hook (toolLegend.ts, toolPalette.ts): the line slots and colours the 3D drawing uses,
 * the legend the key shows, and the legend's pick (one tool's lines stand out). The palette follows the theme:
 * it is read again when the page's theme changes. Display only.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Rgba, ToolColors } from '@synthetos/gcode-view';
import type { PreviewResult } from '../gcode-worker/pipeline.ts';
import { toolStore } from '../workspace/library.ts';
import { parseColor, tokenReader } from './colors.ts';
import { toolLegend, type LegendEntry } from './toolSlots.ts';
import { toolPalette } from './toolPalette.ts';

export interface ToolColorView {
  /** For the drawing, or null when nothing is drawn. */
  readonly colors: ToolColors | null;
  readonly entries: readonly LegendEntry[];
  readonly palette: readonly Rgba[];
  /** The slot the legend picked, or null. */
  readonly focus: number | null;
  readonly setFocus: (slot: number | null) => void;
}

/** A number that changes when the page's theme does (the `data-theme` attribute on the root). */
function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    const observer = new MutationObserver(() => { setTick((n) => n + 1); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { observer.disconnect(); };
  }, []);
  return tick;
}

export function useToolColors(result: PreviewResult | null, spindleTool: number | null): ToolColorView {
  const table = toolStore.value.value;
  const theme = useThemeTick();
  const [focus, setFocus] = useState<number | null>(null);
  const segments = result?.segments ?? null;
  const legend = useMemo(() => (result === null || segments === null ? null : toolLegend(result.tools, result.sourceLines, segments, table, spindleTool)), [result, segments, table, spindleTool]);
  const palette = useMemo(() => toolPalette(parseColor(tokenReader()('--sheet'))), [theme]);
  const colors = useMemo(() => (legend === null ? null : { lineSlots: legend.lineSlots, palette }), [legend, palette]);
  // A new file or tool table drops the pick.
  useEffect(() => { setFocus(null); }, [legend]);
  return { colors, entries: legend?.entries ?? [], palette, focus, setFocus };
}
