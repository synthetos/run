/**
 * The tool inspector's type and shape fields: the tool's type, then only the shape numbers that type takes
 * (V angle and tip for a V-bit, corner radius for a bull nose, point angle for a drill), shank and stickout.
 * The 3D view and the carving draw the tool from these (docs/design/tool-sim.md). Saving goes through the
 * library's validator; a refusal is shown by the inspector.
 */
import { h, type ComponentChild } from 'preact';
import { TOOL_TYPES, type Tool, type ToolType } from '@synthetos/library';
import { TOOL_KINDS } from '../library.ts';
import { geometryForType, SHAPE_FIELD_LABELS, shapeFields, type ShapeField } from '../toolShape.ts';

type Patch = (patch: Readonly<Record<string, unknown>>) => void;

function shapeInput(key: string, label: string, unit: string, value: number | undefined, allowZero: boolean, onChange: (n: number | undefined) => void, optional = false): ComponentChild {
  return h(
    'label',
    { class: 'field', key },
    h('span', null, label),
    h(
      'span',
      { class: 'unit-input' },
      h('input', {
        type: 'number',
        step: 'any',
        min: 0,
        value: value ?? '',
        placeholder: optional ? 'Not set' : undefined,
        'data-tool-field': key,
        onChange: (e: Event) => {
          const raw = (e.currentTarget as HTMLInputElement).value.trim();
          if (raw === '' && optional) return onChange(undefined);
          const n = Number.parseFloat(raw);
          if (Number.isFinite(n) && (n > 0 || (allowZero && n === 0))) onChange(n);
        },
      }),
      h('i', null, unit),
    ),
  );
}

/** The type picker and the shape numbers for `tool`. */
export function ToolShapeFields({ tool, set }: { readonly tool: Tool; readonly set: Patch }): ComponentChild {
  const g = tool.geometry;
  const geo = (field: string, n: number | undefined): void => {
    const next: Record<string, unknown> = { ...g };
    if (n === undefined) delete next[field];
    else next[field] = n;
    set({ geometry: next });
  };
  return [
    h(
      'label',
      { class: 'field', key: 'type' },
      h('span', null, 'Type'),
      h(
        'span',
        { class: 'select-wrap' },
        h(
          'select',
          {
            value: tool.type,
            'data-tool-field': 'type',
            onChange: (e: Event) => {
              const type = (e.currentTarget as HTMLSelectElement).value as ToolType;
              set({ type, geometry: geometryForType(g, type) });
            },
          },
          TOOL_TYPES.map((t) => h('option', { value: t, key: t }, TOOL_KINDS[t] ?? t)),
        ),
      ),
    ),
    ...shapeFields(tool.type).map((field: ShapeField) => {
      const { label, unit } = SHAPE_FIELD_LABELS[field];
      return shapeInput(field, label, unit, g[field], field === 'tipWidth', (n) => geo(field, n), field === 'tipWidth');
    }),
    shapeInput('shank', 'Shank diameter', 'mm', g.shank, false, (n) => geo('shank', n)),
    shapeInput('stickout', 'Stickout', 'mm', g.stickout, false, (n) => geo('stickout', n), true),
  ];
}
