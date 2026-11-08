/**
 * Changing a tool's type in the tool library, and which shape numbers each type shows
 * (docs/design/tool-sim.md: the 3D view and the carving draw the tool from these numbers).
 *
 * Pure. The library's validator (TOOL_TYPE_GEOMETRY) is the rule for which shape numbers a type needs
 * and allows: a type change drops the numbers the new type does not take and fills the ones it needs with
 * a common starting value (90° V, 118° drill point, a small corner radius) for the user to correct. It
 * never touches the diameter, flutes or lengths.
 */
import { TOOL_TYPE_GEOMETRY, type ToolGeometry, type ToolType } from '@synthetos/library';

export type ShapeField = 'cornerRadius' | 'vAngle' | 'tipWidth' | 'pointAngle';

/** Plain words for each shape number, with its unit. */
export const SHAPE_FIELD_LABELS: Readonly<Record<ShapeField, { readonly label: string; readonly unit: string }>> = {
  cornerRadius: { label: 'Corner radius', unit: 'mm' },
  vAngle: { label: 'V angle (included)', unit: '°' },
  tipWidth: { label: 'Tip width', unit: 'mm' },
  pointAngle: { label: 'Point angle', unit: '°' },
};

/** The shape numbers a type shows, required first. */
export function shapeFields(type: ToolType): readonly ShapeField[] {
  const g = TOOL_TYPE_GEOMETRY[type];
  return [...g.required, ...g.optional];
}

/** A starting value for a shape number the new type needs. */
function startingValue(field: ShapeField, diameter: number): number {
  switch (field) {
    case 'vAngle': return 90;
    case 'pointAngle': return 118;
    case 'cornerRadius': return Math.round(Math.min(0.5, diameter / 4) * 1000) / 1000;
    case 'tipWidth': return 0;
  }
}

/** The geometry for `type`: shape numbers it does not take removed, the ones it needs filled. */
export function geometryForType(geometry: ToolGeometry, type: ToolType): ToolGeometry {
  const allowed = new Set<ShapeField>(shapeFields(type));
  const next: Record<string, unknown> = { ...geometry };
  for (const field of Object.keys(SHAPE_FIELD_LABELS) as ShapeField[]) {
    if (!allowed.has(field)) delete next[field];
  }
  for (const field of TOOL_TYPE_GEOMETRY[type].required) {
    if (next[field] === undefined) next[field] = startingValue(field, geometry.diameter);
  }
  return next as unknown as ToolGeometry;
}
