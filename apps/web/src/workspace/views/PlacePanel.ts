/**
 * The Place job step (owner, 2026-11-09; OD-28, docs/design/place-job.md). CAM owns the toolpath and the file's
 * zero; run owns where that zero goes on the real stock, and never rewrites coordinates. The panel:
 * - asks for the same point the CAM program used, with the file's own zero read from its moves (fileZero.ts);
 * - warns when the cut hangs off the stock and another point fits, with a one-click "Use …" (placeFit.ts);
 * - moves zero on the stock (X, Y and depth: PlaceOffset.ts) and shows the margins;
 * - offers the machine's work zero while connected and the position is established (liveZero.ts). That is
 *   display and plan only: nothing is written to the board.
 */
import { h, type ComponentChild } from 'preact';
import { ContextHelp } from '../../shell/ContextHelp.ts';
import type { StockCorner } from '@synthetos/library';
import { effectiveZero, fixtureTop, withDatum, withMachineZero, type Job } from '../jobModel.ts';
import { currentFile } from '../fileBridge.ts';
import { fileZeroOf } from '../fileZeroOf.ts';
import { liveWorkZero } from '../liveZero.ts';
import { toolStore } from '../library.ts';
import { spindleToolChoice } from '../advisorState.ts';
import { cutBounds, placeMargins } from '../placeMargins.ts';
import { fitSuggestion } from '../placeFit.ts';
import { cutToolRadius } from '../placeTool.ts';
import { CLAMPS_NOT_CHECKED } from '../placeTravel.ts';
import { PlaceMargins, PlaceOffset } from './PlaceOffset.ts';

type Edit = (change: (job: Job) => Job) => void;

const ZEROS = ['back-left', null, 'back-right', null, 'center', null, 'front-left', null, 'front-right'] as const;
const mm = (n: number): string => n.toFixed(2);

/** The 5-point picker and the top/bottom choice. A click is the user's pick. */
function ZeroPicker({ job, edit, off }: { readonly job: Job; readonly edit: Edit; readonly off: boolean }): ComponentChild {
  const pick = (corner: StockCorner): void => edit((j) => withDatum(j, { ...j.placement.datum, corner }));
  return h(
    'div',
    { class: 'zero-pick' },
    h('div', { class: 'zero-grid', role: 'radiogroup', 'aria-label': 'Zero point on the stock' }, ZEROS.map((z, i) => (z === null ? h('span', { key: String(i), 'aria-hidden': 'true' }) : h('button', { type: 'button', role: 'radio', key: z, 'aria-checked': !off && job.placement.datum.corner === z ? 'true' : 'false', 'aria-label': z.replace('-', ' '), onClick: () => pick(z) })))),
    h('div', { class: 'seg vertical', role: 'group', 'aria-label': 'Zero height' }, (['top', 'bottom'] as const).map((zh) => h('button', { type: 'button', key: zh, class: !off && job.placement.datum.height === zh ? 'selected' : undefined, onClick: () => edit((j) => withDatum(j, { ...j.placement.datum, height: zh })) }, zh === 'top' ? 'Stock top' : 'Stock bottom'))),
  );
}

/** "A point on the stock" or "The machine's work zero": offered only while the board's zero is known. */
function ZeroSource({ job, edit, live }: { readonly job: Job; readonly edit: Edit; readonly live: { readonly x: number; readonly y: number; readonly z: number } | null }): ComponentChild {
  const machine = job.placement.zeroFrom === 'machine';
  if (live === null && !machine) return null;
  return h(
    'div',
    { class: 'place-source' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Where zero goes', 'data-place': 'zero-source' },
      h('button', { type: 'button', class: machine ? undefined : 'selected', 'aria-pressed': machine ? 'false' : 'true', onClick: () => edit((j) => withMachineZero(j, false)) }, 'A point on the stock'),
      h('button', { type: 'button', class: machine ? 'selected' : undefined, 'aria-pressed': machine ? 'true' : 'false', disabled: live === null, 'data-action': 'place-machine-zero', onClick: () => edit((j) => withMachineZero(j, true)) }, 'Use the machine’s work zero')),
    !machine
      ? null
      : live === null
        ? h('p', { class: 'warn-text', role: 'status', 'data-place': 'machine-zero' }, 'The machine’s work zero is not known now. The plan uses the point on the stock.')
        : h('p', { class: 'fine', 'data-place': 'machine-zero' }, `Placed at the machine’s work zero (X ${mm(live.x)}, Y ${mm(live.y)}, Z ${mm(live.z)} machine mm). Nothing is sent to the board.`),
  );
}

export function PlacePanel({ job, edit, advanced, travel }: { readonly job: Job; readonly edit: Edit; readonly advanced: boolean; readonly travel: string | null }): ComponentChild {
  const file = currentFile.value;
  const live = liveWorkZero.value;
  const onMachine = job.placement.zeroFrom === 'machine' && live !== null;
  const zero = effectiveZero(job, live);
  const preview = file?.preview ?? null;
  const cut = preview?.segments == null ? null : cutBounds(preview.segments);
  const radius = preview === null ? null : cutToolRadius(preview, toolStore.value.value, spindleToolChoice.value);
  const margins = cut === null ? null : placeMargins(job, cut, radius, zero);
  const guess = fileZeroOf(file);
  const fit = cut === null ? null : fitSuggestion(job, cut, zero, guess?.corner ?? null);
  const top = job.setup.bed.toMachine.z + fixtureTop(job);
  const st = job.setup.stock;
  return h(
    'div',
    { class: 'place-panel' },
    h('h2', null, 'Place job'),
    h('p', { class: 'place-lead' }, 'Your CAM program chose where zero is. Pick the same point on your stock.'),
    guess === null ? null : h('p', { class: guess.confidence === 'unclear' ? 'fine warn-text' : 'fine', 'data-place': 'file-zero', 'data-confidence': guess.confidence }, guess.note),
    h(ZeroSource, { job, edit, live }),
    onMachine ? null : h(ZeroPicker, { job, edit, off: false }),
    fit === null
      ? null
      : h('div', { class: 'place-fit', role: 'status', 'data-place': 'mismatch' }, h('p', { class: 'warn-text' }, fit.text), h('button', { type: 'button', class: 'small', 'data-action': 'place-use-fit', onClick: () => edit((j) => withDatum(j, { ...j.placement.datum, corner: fit.corner })) }, fit.action)),
    onMachine ? null : h(PlaceOffset, { job, edit }),
    h(PlaceMargins, { margins, why: preview === null ? 'Open a file to see its margins.' : 'Margins need the drawn file (not lite mode).' }),
    advanced ? h('dl', { class: 'job-zero-facts' }, h('dt', null, onMachine ? 'Work zero · machine mm' : 'Planned zero · machine mm'), h('dd', { 'data-job': 'planned-zero' }, `X ${mm(zero.x)} · Y ${mm(zero.y)} · Z ${mm(zero.z)}`)) : null,
    h('dl', { class: 'job-zero-facts', 'aria-label': 'Setup heights in machine coordinates' },
      h('dt', null, 'Stock top · machine Z'), h('dd', { 'data-height': 'stock' }, mm(top + st.thickness)),
      h('dt', null, 'Fixture top · machine Z'), h('dd', { 'data-height': 'fixture' }, mm(top)),
      h('dt', null, 'Bed top · machine Z'), h('dd', { 'data-height': 'bed' }, mm(job.setup.bed.toMachine.z))),
    h(ContextHelp, { id: 'job-datum-help', label: 'About work zero' }, 'Your CAM program set zero when it made the file. Run never changes the file’s coordinates. This step places the preview on the stock. It does not set the board’s work offset. Use the Offsets controls to set and check the real zero.'),
    h('p', { class: 'fine', 'data-place': 'travel' }, travel ?? 'Travel is checked when a machine is connected and homed.'),
    h('p', { class: 'fine', 'data-place': 'clamps' }, CLAMPS_NOT_CHECKED),
  );
}
