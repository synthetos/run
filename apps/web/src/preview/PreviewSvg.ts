/**
 * The 2D drawing (ROADMAP TB-03): a top view as SVG, for browsers without
 * WebGL2. Elements are built by Preact (createElementNS), never from markup.
 *
 * With a scene the bed, fixture, stock and clamps are drawn as their top
 * faces under the path (machine coordinates, Y flipped like the path), and
 * the path is moved to the planned work zero by a translated group.
 */
import { h, type ComponentChild } from 'preact';
import { svgEnvelope, svgGrid, svgPaths, svgScene, type Box3, type SceneLayers, type SegmentList, type Vec3 } from '@synthetos/gcode-view';

export interface PreviewSvgProps {
  /** The path, or null for a scene alone. */
  readonly segments: SegmentList | null;
  readonly showRapids: boolean;
  readonly highlight: number;
  readonly envelope: Box3 | null;
  /** P1-07: the live position (work coordinates, from the reported machine position), or null. */
  readonly marker?: { readonly x: number; readonly y: number; readonly lag: string } | null;
  readonly scene?: SceneLayers | null;
  readonly pathOffset?: Vec3;
  readonly zero?: Vec3;
  readonly label?: string;
}

/** Marker radius: 1.5 % of the larger view-box side. */
export function markerRadius(viewBox: string | null): number {
  const parts = (viewBox ?? '0 0 1 1').split(' ').map(Number);
  return Math.max(parts[2] ?? 1, parts[3] ?? 1) * 0.015;
}

const EMPTY: SegmentList = { vertices: new Float32Array(3), kinds: new Uint8Array(1), lineToVertex: new Uint32Array([1]) };

const fmt = (n: number): string => (Math.round(n * 1000) / 1000).toString();

export function PreviewSvg({ segments, showRapids, highlight, envelope, marker = null, scene = null, pathOffset = [0, 0, 0], zero, label }: PreviewSvgProps): ComponentChild {
  const sc = svgScene(scene);
  const list = segments ?? EMPTY;
  const p = svgPaths(list, { showRapids, highlightLine: highlight, envelope, offset: pathOffset, extent: sc.bounds });
  const grid = svgGrid(list, { showRapids, envelope, offset: pathOffset, extent: sc.bounds });
  const translate = `translate(${fmt(pathOffset[0])} ${fmt(-pathOffset[1])})`;
  const beds = sc.solids.filter((s) => s.tag === 'bed');
  const rest = sc.solids.filter((s) => s.tag !== 'bed');
  const r = markerRadius(p.viewBox);
  return h(
    'figure',
    { class: 'preview-svg', 'data-preview': 'svg' },
    h(
      'svg',
      { viewBox: p.viewBox ?? '0 0 1 1', role: 'img', 'aria-label': label ?? 'Toolpath preview, top view (X right, Y up)', preserveAspectRatio: 'xMidYMid meet' },
      beds.map((s, i) => h('path', { key: `bed${i}`, class: 'pv-solid pv-bed', d: s.d, 'data-preview': 'scene-bed' })),
      grid.minor === '' ? null : h('path', { class: 'pv-grid', d: grid.minor, 'data-preview': 'grid' }),
      grid.major === '' ? null : h('path', { class: 'pv-grid-major', d: grid.major }),
      rest.map((s, i) => h('path', { key: `s${i}`, class: `pv-solid pv-${s.tag}`, d: s.d, 'data-preview': `scene-${s.tag}` })),
      sc.rings.map((c, i) => h('circle', { key: `r${i}`, class: 'pv-ring', cx: c.cx, cy: c.cy, r: c.r })),
      envelope === null ? null : h('path', { class: 'pv-envelope', d: svgEnvelope(envelope) }),
      h(
        'g',
        { transform: translate, 'data-preview': 'path-group' },
        h('path', { class: 'pv-rapid', d: p.rapid }),
        h('path', { class: 'pv-feed', d: p.feed }),
        h('path', { class: 'pv-uncertain', d: p.uncertain }),
        h('path', { class: 'pv-oob', d: p.outOfBounds }),
        h('path', { class: 'pv-highlight', d: p.highlight }),
        marker === null ? null : h('circle', { class: `pv-marker lag-${marker.lag}`, 'data-preview': 'marker', cx: marker.x, cy: -marker.y, r }),
      ),
      zero === undefined ? null : h('g', { class: 'pv-zero', 'data-preview': 'zero' }, h('path', { class: 'pv-axis-x', d: `M${fmt(zero[0])} ${fmt(-zero[1])}L${fmt(zero[0] + r * 4)} ${fmt(-zero[1])}` }), h('path', { class: 'pv-axis-y', d: `M${fmt(zero[0])} ${fmt(-zero[1])}L${fmt(zero[0])} ${fmt(-zero[1] - r * 4)}` })),
    ),
    h('figcaption', null, 'Top view.', p.decimated ? ' Simplified: some segments are left out at this size.' : '', ' Out-of-bounds moves are red.', scene === null ? '' : ' Bed, fixture and stock in machine coordinates; the path at the planned work zero.'),
  );
}
