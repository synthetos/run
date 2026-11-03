/**
 * The 2D drawing (ROADMAP TB-03): a top view as SVG, for browsers without
 * WebGL2. Elements are built by Preact (createElementNS), never from markup.
 */
import { h, type ComponentChild } from 'preact';
import { svgEnvelope, svgGrid, svgPaths, type Box3, type SegmentList } from '@synthetos/gcode-view';

export interface PreviewSvgProps {
  readonly segments: SegmentList;
  readonly showRapids: boolean;
  readonly highlight: number;
  readonly envelope: Box3 | null;
  /** P1-07: the live position (work coordinates, from the reported machine position), or null. */
  readonly marker?: { readonly x: number; readonly y: number; readonly lag: string } | null;
}

/** Marker radius: 1.5 % of the larger view-box side. */
export function markerRadius(viewBox: string | null): number {
  const parts = (viewBox ?? '0 0 1 1').split(' ').map(Number);
  return Math.max(parts[2] ?? 1, parts[3] ?? 1) * 0.015;
}

export function PreviewSvg({ segments, showRapids, highlight, envelope, marker = null }: PreviewSvgProps): ComponentChild {
  const p = svgPaths(segments, { showRapids, highlightLine: highlight, envelope });
  const grid = svgGrid(segments, { showRapids, envelope });
  return h(
    'figure',
    { class: 'preview-svg', 'data-preview': 'svg' },
    h(
      'svg',
      { viewBox: p.viewBox ?? '0 0 1 1', role: 'img', 'aria-label': 'Toolpath preview, top view (X right, Y up)', preserveAspectRatio: 'xMidYMid meet' },
      grid.minor === '' ? null : h('path', { class: 'pv-grid', d: grid.minor, 'data-preview': 'grid' }),
      grid.major === '' ? null : h('path', { class: 'pv-grid-major', d: grid.major }),
      envelope === null ? null : h('path', { class: 'pv-envelope', d: svgEnvelope(envelope) }),
      h('path', { class: 'pv-rapid', d: p.rapid }),
      h('path', { class: 'pv-feed', d: p.feed }),
      h('path', { class: 'pv-uncertain', d: p.uncertain }),
      h('path', { class: 'pv-oob', d: p.outOfBounds }),
      h('path', { class: 'pv-highlight', d: p.highlight }),
      marker === null ? null : h('circle', { class: `pv-marker lag-${marker.lag}`, 'data-preview': 'marker', cx: marker.x, cy: -marker.y, r: markerRadius(p.viewBox) }),
    ),
    h('figcaption', null, 'Top view.', p.decimated ? ' Simplified: some segments are left out at this size.' : '', ' Out-of-bounds moves are red.'),
  );
}
