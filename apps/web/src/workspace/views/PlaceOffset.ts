/**
 * Under the work zero picker (owner, 2026-11-09; OD-28): "Move it on the stock" X and Y (inward from a corner,
 * machine directions from the centre), "Zero is [ ] mm below the stock top" (or above the bottom), and the margins
 * from the cutting moves to the stock edges at the job's zero. Positive Z moves zero down from the top, or up from
 * the bottom. It edits the job's placement only; the file's coordinates never change.
 */
import { h, type ComponentChild } from 'preact';
import { placementOffset, withOffset, type Job } from '../jobModel.ts';
import { marginsText, pastEdgesText, radiusText, type Margins } from '../placeMargins.ts';
import { field } from './numberField.ts';

type Edit = (change: (job: Job) => Job) => void;

/** "Zero is [ 2 ] mm below the stock top": the Z offset, for CAM set to the model top inside a thicker blank. */
export function ZeroDepth({ job, edit }: { readonly job: Job; readonly edit: Edit }): ComponentChild {
  const o = placementOffset(job);
  const top = job.placement.datum.height === 'top';
  return h(
    'label',
    { class: 'place-z', 'data-place': 'z-offset' },
    h('span', null, 'Zero is'),
    h(
      'span',
      { class: 'unit-input' },
      h('input', {
        type: 'number',
        value: o.z,
        step: 0.1,
        'aria-label': top ? 'Zero depth below the stock top' : 'Zero height above the stock bottom',
        onChange: (e: Event) => {
          const n = Number.parseFloat((e.currentTarget as HTMLInputElement).value);
          if (Number.isFinite(n) && Math.abs(n) <= 10000) edit((j) => withOffset(j, { ...placementOffset(j), z: n }));
        },
      }),
      h('i', null, 'mm'),
    ),
    h('span', null, top ? 'below the stock top' : 'above the stock bottom'),
  );
}

/** X/Y "Move it on the stock" and Z, for a point on the stock. */
export function PlaceOffset({ job, edit }: { readonly job: Job; readonly edit: Edit }): ComponentChild {
  const o = placementOffset(job);
  const centre = job.placement.datum.corner === 'center';
  const set = (patch: Partial<{ x: number; y: number }>): void => edit((j) => withOffset(j, { ...placementOffset(j), ...patch }));
  return h(
    'div',
    { class: 'place-offset', 'data-setup': 'place-offset' },
    h('span', { class: 'place-offset-label' }, 'Move it on the stock'),
    h('div', { class: 'field-grid' }, field('X', o.x, (x) => set({ x }), 'mm', 0.5, -10000), field('Y', o.y, (y) => set({ y }), 'mm', 0.5, -10000)),
    h('p', { class: 'fine' }, centre ? 'X and Y move it in the machine’s directions.' : 'Positive moves the job in, toward the middle of the stock.'),
    h(ZeroDepth, { job, edit }),
  );
}

/** The margins at the job's zero, or why there are none. */
export function PlaceMargins({ margins, why }: { readonly margins: Margins | null; readonly why: string }): ComponentChild {
  if (margins === null) return h('p', { class: 'fine', 'data-place': 'margins' }, why);
  const past = pastEdgesText(margins);
  return h(
    'div',
    { class: 'place-offset' },
    h('p', { class: 'place-margins', 'data-place': 'margins' }, marginsText(margins)),
    h('p', { class: 'fine', 'data-place': 'margins-tool' }, radiusText(margins.radius)),
    past === null ? null : h('p', { class: 'warn-text', role: 'status', 'data-place': 'past-edge' }, past),
  );
}
