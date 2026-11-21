import type { Tool, ToolType } from '@synthetos/library';
import { formatLength, type ToolUnit } from './units.ts';
import { catalogCutLength } from './catalogText.ts';
const TYPES: Record<ToolType, string> = { flat: 'end mill', ball: 'ball nose', 'bull-nose': 'bull nose', engraver: 'engraver', surfacing: 'surfacing mill', 'thread-mill': 'thread mill', 'v-bit': 'V-bit', drill: 'drill', chamfer: 'chamfer mill', 'o-flute': 'O-flute' };
export function customToolName(name: string): string {
  return /^T\d+ tool$/.test(name) ? '' : name.trim();
}
/** The name, or the size and kind when it has none: "6.35 mm end mill", or '1/4" end mill' for inches. */
export function toolDisplayName(tool: Pick<Tool, 'name' | 'type' | 'geometry'>, unit: ToolUnit = 'mm'): string {
  const size = unit === 'in' ? catalogCutLength(tool.geometry.diameter, 'in') : `${formatLength(tool.geometry.diameter, 'mm')} mm`;
  return customToolName(tool.name) || `${size} ${TYPES[tool.type]}`;
}
