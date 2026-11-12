import type { Tool, ToolType } from '@synthetos/library';
import { formatLength } from './units.ts';
const TYPES: Record<ToolType, string> = { flat: 'end mill', ball: 'ball nose', 'bull-nose': 'bull nose', engraver: 'engraver', surfacing: 'surfacing mill', 'thread-mill': 'thread mill', 'v-bit': 'V-bit', drill: 'drill', chamfer: 'chamfer mill', 'o-flute': 'O-flute' };
export function customToolName(name: string): string {
  return /^T\d+ tool$/.test(name) ? '' : name.trim();
}
export function toolDisplayName(tool: Pick<Tool, 'name' | 'type' | 'geometry'>): string {
  return customToolName(tool.name) || `${formatLength(tool.geometry.diameter, 'mm')} mm ${TYPES[tool.type]}`;
}
