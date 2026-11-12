import { stored } from '../storage.ts';
import type { ToolUnit } from './units.ts';
export const toolUnits = stored<ToolUnit>('tool-units', 'mm', (v): v is ToolUnit => v === 'mm' || v === 'in');
