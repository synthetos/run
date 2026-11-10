/**
 * The tool's fields with the drawing above them (Library → Tools → Details). The drawing follows the fields as you
 * type (before a value is saved), pointing at or focusing a field highlights its dimension with a one-line meaning,
 * and choosing a dimension on the drawing focuses its field. A number that cannot be right is drawn as typed and
 * flagged under the drawing and on its field; saving still goes through the library's validator.
 *
 * The fields are the inspector's own (they carry `data-tool-field`); this only listens to them.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Tool, ToolGeometry } from '@synthetos/library';
import { DRAWING_HINT, TOOL_FIELD_MEANING } from './meanings.ts';
import { toolDrawingModel, type DimKey } from './model.ts';
import { ToolDrawing, dimOfField } from './ToolDrawing.ts';

const NUMBER_FIELDS: ReadonlySet<string> = new Set(['diameter', 'shank', 'stickout', 'fluteLength', 'overallLength', 'flutes', 'cornerRadius', 'vAngle', 'tipWidth', 'pointAngle']);

/** A typed value not yet saved: a number, or null for an optional number cleared (the stickout). */
type Drafts = Readonly<Record<string, number | null>>;

/** The geometry as typed: the saved one with the drafts over it. */
export function draftGeometry(g: ToolGeometry, drafts: Drafts): ToolGeometry {
  const next: Record<string, unknown> = { ...g };
  for (const [k, v] of Object.entries(drafts)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next as unknown as ToolGeometry;
}

function fieldOf(e: Event): string | null {
  const el = (e.target as Element | null)?.closest?.('[data-tool-field]') ?? null;
  const key = el?.getAttribute('data-tool-field') ?? null;
  return key !== null && NUMBER_FIELDS.has(key) ? key : null;
}

export function ToolDrawingEditor({ tool, children }: { readonly tool: Tool; readonly children?: ComponentChild }): ComponentChild {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [onDrawing, setOnDrawing] = useState<DimKey | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // A draft is done once the saved geometry holds it.
  useEffect(() => {
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k, v]) => (tool.geometry as unknown as Record<string, unknown>)[k] !== (v ?? undefined))));
  }, [tool.geometry]);
  const shown = { type: tool.type, geometry: draftGeometry(tool.geometry, drafts) };
  const model = toolDrawingModel(shown);
  // Each field with a number that cannot be right says so to assistive technology too.
  const flagged = new Set(model.issues.map((i) => i.key));
  useEffect(() => {
    for (const el of root.current?.querySelectorAll<HTMLInputElement>('input[data-tool-field]') ?? []) {
      const key = el.getAttribute('data-tool-field') ?? '';
      if (flagged.has(key as DimKey)) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    }
  });
  // The field under the pointer wins while it is there; else the focused one.
  const pointed = hovered ?? focused;
  const active = dimOfField(pointed) ?? onDrawing;
  const meaning = TOOL_FIELD_MEANING[pointed ?? onDrawing ?? ''] ?? DRAWING_HINT;
  const pick = (key: DimKey): void => {
    root.current?.querySelector<HTMLInputElement>(`input[data-tool-field="${key}"]`)?.focus();
  };
  return h(
    'div',
    { class: 'tool-editor', ref: root },
    h(
      'figure',
      { class: 'tool-figure', 'data-tool-figure': '' },
      h(ToolDrawing, { tool: shown, active, onPick: pick, onHover: setOnDrawing }),
      h('figcaption', { class: 'tf-meaning', 'aria-live': 'polite', 'data-tool-meaning': '' }, meaning),
      model.issues.length === 0 ? null : h('ul', { class: 'tf-issues', 'data-tool-issues': '' }, model.issues.map((i, n) => h('li', { key: String(n), 'data-issue': i.key }, h('span', { 'aria-hidden': 'true' }, '⚠ '), i.text))),
    ),
    h(
      'div',
      {
        class: 'tool-editor-fields',
        onFocusIn: (e: FocusEvent) => setFocused(fieldOf(e)),
        onFocusOut: () => setFocused(null),
        onMouseOver: (e: MouseEvent) => setHovered(fieldOf(e)),
        onMouseLeave: () => setHovered(null),
        onInput: (e: Event) => {
          const key = fieldOf(e);
          if (key === null) return;
          const raw = (e.target as HTMLInputElement).value.trim();
          const n = Number.parseFloat(raw);
          if (raw === '' && key === 'stickout') setDrafts((d) => ({ ...d, stickout: null }));
          else if (Number.isFinite(n) && n >= 0) setDrafts((d) => ({ ...d, [key]: n }));
        },
      },
      children,
    ),
  );
}
