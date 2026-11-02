/**
 * The 2D drawing (ROADMAP TB-03): a top view as SVG, for browsers without
 * WebGL2. Elements are built by Preact (createElementNS), never from markup.
 */
import { h, type ComponentChild } from 'preact';
import { svgEnvelope, svgPaths, type Box3, type SegmentList } from '@synthetos/gcode-view';

export interface PreviewSvgProps {
  readonly segments: SegmentList;
  readonly showRapids: boolean;
  readonly highlight: number;
  readonly envelope: Box3 | null;
}

export function PreviewSvg({ segments, showRapids, highlight, envelope }: PreviewSvgProps): ComponentChild {
  const p = svgPaths(segments, { showRapids, highlightLine: highlight, envelope });
  return h(
    'figure',
    { class: 'preview-svg', 'data-preview': 'svg' },
    h(
      'svg',
      { viewBox: p.viewBox ?? '0 0 1 1', role: 'img', 'aria-label': 'Toolpath preview, top view (X right, Y up)', preserveAspectRatio: 'xMidYMid meet' },
      envelope === null ? null : h('path', { class: 'pv-envelope', d: svgEnvelope(envelope) }),
      h('path', { class: 'pv-rapid', d: p.rapid }),
      h('path', { class: 'pv-feed', d: p.feed }),
      h('path', { class: 'pv-uncertain', d: p.uncertain }),
      h('path', { class: 'pv-oob', d: p.outOfBounds }),
      h('path', { class: 'pv-highlight', d: p.highlight }),
    ),
    h('figcaption', null, 'Top view.', p.decimated ? ' Simplified: some segments are left out at this size.' : '', ' Out-of-bounds moves are red.'),
  );
}
