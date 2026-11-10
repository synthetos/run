/**
 * The tool drawn to scale from the side (toolDrawing/model.ts): the holder face with a hatched holder block, the
 * shank, the fluted part with flute hatching, and the tip by type, on a light grid with a scale bar, with dimension
 * lines for the diameter, the shank, the flute length, the overall length and the stickout. Above the holder face
 * the tool is faint (it is inside the collet). A dimension pointed at, or whose field is, is highlighted; a number
 * that cannot be right is drawn as typed and marked.
 *
 * `thumb` draws the outline and the flutes only, at the size of a list icon, from the same model.
 * Colours come from the theme tokens (both themes).
 */
import { h, type ComponentChild } from 'preact';
import { useMemo } from 'preact/hooks';
import type { Tool } from '@synthetos/library';
import { fluteHatch, niceStep, toolDrawingModel, type DimKey, type Dimension, type ToolDrawingModel } from './model.ts';
import { TOOL_FIELD_MEANING } from './meanings.ts';

let instance = 0;

/** Which dimension a field highlights (the tip's own numbers highlight the diameter, where the tip is drawn). */
export function dimOfField(field: string | null): DimKey | null {
  if (field === null) return null;
  if (field === 'diameter' || field === 'shank' || field === 'stickout' || field === 'fluteLength' || field === 'overallLength') return field;
  if (field === 'flutes') return 'fluteLength';
  if (field === 'cornerRadius' || field === 'vAngle' || field === 'tipWidth' || field === 'pointAngle') return 'diameter';
  return null;
}

interface Frame {
  readonly s: number;
  readonly x: (mm: number) => number;
  readonly y: (mm: number) => number;
}

function pathOf(points: readonly (readonly [number, number])[], f: Frame): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${f.x(x).toFixed(2)} ${f.y(y).toFixed(2)}`).join('') + 'Z';
}

function Thumb({ m }: { readonly m: ToolDrawingModel }): ComponentChild {
  const id = useMemo(() => `tt${++instance}`, []);
  const w = Math.max(m.radius, m.shankRadius) * 2;
  const pad = w * 0.12 + 0.2;
  const f: Frame = { s: 1, x: (x) => x, y: (y) => -y };
  return h(
    'svg',
    { class: 'tool-art tool-thumb', viewBox: `${-w / 2 - pad} ${-m.top - pad} ${w + 2 * pad} ${m.top + 2 * pad}`, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' },
    h('defs', null, h('clipPath', { id }, h('path', { d: pathOf(m.outline, f) }))),
    h('path', { class: 'body', d: pathOf(m.outline, f) }),
    h('g', { 'clip-path': `url(#${id})` }, fluteHatch(m).map(([x0, y0, x1, y1], i) => h('line', { key: String(i), class: 'flute', x1: x0, y1: -y0, x2: x1, y2: -y1 }))),
  );
}

const W = 320;
const H = 260;
const LEFT = 64;
const RIGHT = 52;
const TOP = 34;
const BOTTOM = 40;

function frameFor(m: ToolDrawingModel): Frame {
  const width = Math.max(m.radius, m.shankRadius) * 2;
  const tall = Math.max(m.top, m.holder ?? 0);
  const s = Math.max(0.5, Math.min((W - LEFT - RIGHT) / Math.max(width, 0.1), (H - TOP - BOTTOM) / Math.max(tall, 0.1)));
  const cx = LEFT + (W - LEFT - RIGHT) / 2;
  const base = H - BOTTOM;
  return { s, x: (x) => cx + x * s, y: (y) => base - y * s };
}

function DimLine({ d, f, m, arrow, active, warn, onPick, onHover }: { readonly d: Dimension; readonly arrow: string; readonly f: Frame; readonly m: ToolDrawingModel; readonly active: boolean; readonly warn: boolean; readonly onPick?: (key: DimKey) => void; readonly onHover?: (key: DimKey | null) => void }): ComponentChild {
  const maxX = f.x(Math.max(m.radius, m.shankRadius));
  const minX = f.x(-Math.max(m.radius, m.shankRadius));
  const parts: ComponentChild[] = [];
  let label: ComponentChild;
  if (d.orient === 'across') {
    // The diameter under the tip, the shank over the top, each with extension lines to the edge it measures.
    const edgeY = d.key === 'diameter' ? f.y(m.tipTop) : f.y(m.top);
    const y = d.key === 'diameter' ? f.y(0) + 16 : f.y(Math.max(m.top, m.holder ?? 0)) - 14;
    const x0 = f.x(d.from);
    const x1 = f.x(d.to);
    parts.push(h('line', { class: 'tf-ext', x1: x0, y1: edgeY, x2: x0, y2: y }), h('line', { class: 'tf-ext', x1: x1, y1: edgeY, x2: x1, y2: y }), h('line', { class: 'tf-dimline', x1: x0, y1: y, x2: x1, y2: y, 'marker-start': `url(#${arrow})`, 'marker-end': `url(#${arrow})` }));
    label = h('text', { x: (x0 + x1) / 2, y: d.key === 'diameter' ? y + 12 : y - 4, 'text-anchor': 'middle' }, d.label);
  } else {
    const lane = d.key === 'stickout' ? maxX + 22 : d.key === 'fluteLength' ? minX - 18 : minX - 40;
    const edge = d.key === 'stickout' ? maxX : minX;
    const y0 = f.y(d.from);
    const y1 = f.y(d.to);
    parts.push(h('line', { class: 'tf-ext', x1: edge, y1: y1, x2: lane, y2: y1 }), h('line', { class: 'tf-ext', x1: edge, y1: y0, x2: lane, y2: y0 }), h('line', { class: 'tf-dimline', x1: lane, y1: y0, x2: lane, y2: y1, 'marker-start': `url(#${arrow})`, 'marker-end': `url(#${arrow})` }));
    const tx = d.key === 'stickout' ? lane + 11 : lane - 5;
    label = h('text', { x: tx, y: (y0 + y1) / 2, 'text-anchor': 'middle', transform: `rotate(-90 ${tx} ${(y0 + y1) / 2})` }, d.label);
  }
  const meaning = TOOL_FIELD_MEANING[d.key] ?? '';
  return h(
    'g',
    {
      class: `tf-dim${active ? ' active' : ''}${warn ? ' warn' : ''}`,
      'data-dim': d.key,
      tabindex: onPick === undefined ? undefined : 0,
      role: onPick === undefined ? undefined : 'button',
      'aria-label': `${meaning.split(':')[0] ?? d.key}: ${String(Math.round(d.value * 100) / 100)} mm. Edit it`,
      onClick: () => onPick?.(d.key),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick?.(d.key);
        }
      },
      onFocus: () => onHover?.(d.key),
      onBlur: () => onHover?.(null),
      onMouseEnter: () => onHover?.(d.key),
      onMouseLeave: () => onHover?.(null),
    },
    h('title', null, meaning),
    ...parts,
    label,
  );
}

export interface ToolDrawingProps {
  readonly tool: Pick<Tool, 'type' | 'geometry'>;
  readonly thumb?: boolean;
  /** The dimension to highlight (its field is focused or pointed at), or null. */
  readonly active?: DimKey | null;
  /** A dimension was chosen on the drawing: focus its field. */
  readonly onPick?: (key: DimKey) => void;
  /** A dimension is pointed at or focused on the drawing (null: no longer). */
  readonly onHover?: (key: DimKey | null) => void;
}

export function ToolDrawing({ tool, thumb = false, active = null, onPick, onHover }: ToolDrawingProps): ComponentChild {
  const m = toolDrawingModel(tool);
  if (thumb) return h(Thumb, { m });
  return h(Full, { m, active, ...(onPick === undefined ? {} : { onPick }), ...(onHover === undefined ? {} : { onHover }) });
}

function Full({ m, active, onPick, onHover }: { readonly m: ToolDrawingModel; readonly active: DimKey | null; readonly onPick?: (key: DimKey) => void; readonly onHover?: (key: DimKey | null) => void }): ComponentChild {
  const id = useMemo(() => `tf${++instance}`, []);
  const f = frameFor(m);
  const step = niceStep(f.s);
  const warnKeys = new Set(m.issues.map((i) => i.key));
  const outline = pathOf(m.outline, f);
  const hatch = fluteHatch(m).map(([x0, y0, x1, y1], i) => h('line', { key: String(i), class: 'tf-flute', x1: f.x(x0), y1: f.y(y0), x2: f.x(x1), y2: f.y(y1) }));
  const grid: ComponentChild[] = [];
  const gx0 = LEFT - 40;
  for (let x = f.x(0) % (step * f.s); x <= W; x += step * f.s) grid.push(h('line', { key: `x${x}`, class: 'tf-grid', x1: x, y1: 8, x2: x, y2: H - 8 }));
  for (let y = f.y(0); y >= 8; y -= step * f.s) grid.push(h('line', { key: `y${y}`, class: 'tf-grid', x1: 8, y1: y, x2: W - 8, y2: y }));
  const holderY = m.holder === null ? null : f.y(m.holder);
  const holderHalf = Math.max(m.radius, m.shankRadius) * f.s + 14;
  const tool3 = (cls: string): ComponentChild => h('g', { class: cls }, h('path', { class: 'tf-body', d: outline }), h('g', { 'clip-path': `url(#${id}-o)` }, hatch), h('path', { class: 'tf-edge', d: outline }));
  const summary = m.dims.map((d) => `${(TOOL_FIELD_MEANING[d.key] ?? d.key).split(':')[0] ?? ''} ${String(Math.round(d.value * 100) / 100)} mm`).join(', ');
  return h(
    'svg',
    { class: 'tool-figure-svg', viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': `Side view of the tool, to scale: ${summary}`, 'data-tool-drawing': '' },
    h(
      'defs',
      null,
      h('clipPath', { id: `${id}-o` }, h('path', { d: outline })),
      holderY === null ? null : h('clipPath', { id: `${id}-below` }, h('rect', { x: 0, y: holderY, width: W, height: H - holderY })),
      h('pattern', { id: `${id}-hatch`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, h('line', { class: 'tf-hatch', x1: 0, y1: 0, x2: 0, y2: 6 })),
      h('marker', { id: `${id}-arrow`, viewBox: '0 0 8 8', refX: 4, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, h('path', { class: 'tf-arrowhead', d: 'M0 1L7 4L0 7Z' })),
    ),
    h('rect', { class: 'tf-bg', x: 0, y: 0, width: W, height: H, rx: 4 }),
    h('g', { 'aria-hidden': 'true' }, grid),
    // The tool: faint all over, then solid below the holder face (the part out of the collet).
    holderY === null ? tool3('tf-tool') : [tool3('tf-tool faint'), h('g', { 'clip-path': `url(#${id}-below)` }, tool3('tf-tool'))],
    m.holder !== null && warnKeys.has('fluteLength') && m.fluteTop > m.holder
      ? h('rect', { class: 'tf-warn-zone', x: f.x(-m.radius), y: f.y(m.fluteTop), width: m.radius * 2 * f.s, height: (m.fluteTop - m.holder) * f.s })
      : null,
    holderY === null
      ? null
      : h(
          'g',
          { class: `tf-holder${warnKeys.has('stickout') ? ' warn' : ''}`, 'data-holder': '' },
          h('rect', { class: 'tf-holder-block', x: f.x(0) - holderHalf, y: holderY - 18, width: holderHalf * 2, height: 18, fill: `url(#${id}-hatch)` }),
          h('line', { class: 'tf-holder-face', x1: f.x(0) - holderHalf - 6, y1: holderY, x2: f.x(0) + holderHalf + 6, y2: holderY }),
        ),
    m.dims.map((d) => h(DimLine, { key: d.key, d, f, m, arrow: `${id}-arrow`, active: active === d.key, warn: warnKeys.has(d.key), ...(onPick === undefined ? {} : { onPick }), ...(onHover === undefined ? {} : { onHover }) })),
    h(
      'g',
      { class: 'tf-scale', 'aria-hidden': 'true' },
      h('line', { x1: gx0 + 12, y1: H - 12, x2: gx0 + 12 + step * f.s, y2: H - 12 }),
      h('line', { x1: gx0 + 12, y1: H - 16, x2: gx0 + 12, y2: H - 8 }),
      h('line', { x1: gx0 + 12 + step * f.s, y1: H - 16, x2: gx0 + 12 + step * f.s, y2: H - 8 }),
      h('text', { x: gx0 + 18 + step * f.s, y: H - 9 }, `${String(step)} mm`),
    ),
  );
}
