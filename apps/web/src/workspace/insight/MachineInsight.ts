/**
 * The Advanced block under the jog controls (owner, 2026-11-09): "Planner" (buffer, queued motion, lines, report
 * age) and "Cutting" (tool, spindle, feed, chip load, surface speed against the job's material). Read only: it shows
 * live state already polled and sends nothing to the board. Hidden while no board is connected.
 */
import { h, type ComponentChild } from 'preact';
import { DIALECTS } from '@synthetos/protocol';
import { connected, type WorkspaceModel } from '../model.ts';
import { ageText } from '../reportAge.ts';
import { duration } from '../jobUi.ts';
import { material, toolStore } from '../library.ts';
import { activeJob } from '../jobModel.ts';
import { viewRequest } from '../boardNavigation.ts';
import { openToolNumber } from '../toolNumbers.ts';
import { plannerRows, type PlannerRows } from './plannerModel.ts';
import { cuttingRows, type CuttingRows, type Fix } from './cuttingModel.ts';

const n0 = (v: number): string => Math.round(v).toLocaleString('en-US');
const n3 = (v: number): string => v.toFixed(3);

function row(key: string, label: string, ...value: ComponentChild[]): ComponentChild {
  return h('li', { key, 'data-insight-row': key }, h('span', { class: 'insight-label' }, label), h('span', { class: 'insight-value' }, ...value));
}

export function plannerList(p: PlannerRows, age: string): ComponentChild {
  const b = p.buffer;
  return h(
    'ul',
    { class: 'rows insight-rows' },
    row(
      'buffer',
      'Buffer',
      b === null
        ? 'Not reported'
        : h(
            'span',
            { class: `planner-meter${b.starving ? ' starving' : ''}`, 'data-starving': b.starving ? 'true' : 'false' },
            h('span', { class: 'planner-bar', role: 'meter', 'aria-label': 'Planner blocks in use', 'aria-valuemin': 0, 'aria-valuemax': b.total, 'aria-valuenow': b.used }, h('i', { style: { width: `${(100 * b.used) / b.total}%` } })),
            h('span', { class: 'planner-count' }, `${b.used} of ${b.total}`),
            b.starving ? h('span', { class: 'planner-warn' }, '⚠ Starving') : null,
          ),
    ),
    row('queued', 'Queued motion', p.queued === null ? 'None' : `about ${duration(p.queued.seconds)}${p.queued.mm === null ? '' : ` / ${n0(p.queued.mm)} mm`}`),
    p.lines === null ? null : row('lines', 'Lines', `sent ${n0(p.lines.sent)} · answered ${n0(p.lines.acked)} · running N${p.lines.executing === null ? '–' : n0(p.lines.executing)}`),
    row('age', 'Status reports', age),
  );
}

function follow(fix: Fix): void {
  if (fix.kind === 'tool') {
    openToolNumber(fix.number);
    viewRequest.value = 'tools';
  } else if (fix.kind === 'step') viewRequest.value = 'setup'; // the Job view at Stock & workholding
  else viewRequest.value = fix.view;
}

export function cuttingList(c: CuttingRows): ComponentChild {
  const fz = c.chipLoad;
  const range = fz?.range ?? null;
  const rangeText = range === null ? '' : ` (${n3(range.min)}–${n3(range.max)})`;
  // Short (owner, 2026-11-10: "less is more"; OD-35): "✓ 0.033 mm/tooth", or the value with "⚠ light (0.019–0.031)".
  const warn =
    fz === null || fz.verdict === null || fz.verdict === 'ok'
      ? null
      : h('span', { class: 'insight-warn', 'data-verdict': fz.verdict }, `⚠ ${fz.verdict}${fz.rubbing ? ', rubbing risk' : ''}${rangeText}`);
  const spindleOff = c.spindle !== null && c.spindle.rpm === 0;
  return h(
    'ul',
    { class: 'rows insight-rows' },
    c.tool === null
      ? null
      : row('tool', 'Tool', `T${c.tool.number} · ${c.tool.name}`, h('span', { class: 'insight-sub' }, `${c.tool.diameter} mm · ${c.tool.flutes} ${c.tool.flutes === 1 ? 'flute' : 'flutes'}${c.tool.from === 'file' ? ' · from the file' : ''}`)),
    row('spindle', 'Spindle', c.spindle === null ? 'Not known' : spindleOff ? 'Off' : `${n0(c.spindle.rpm)} rpm${c.spindle.from === 'file' ? ' (from the file)' : ''}`),
    c.feed === null ? row('feed', 'Feed', 'Not known') : row('feed', 'Feed', `${n0(c.feed.mmMin)} mm/min`, h('span', { class: 'insight-sub' }, c.feed.from === 'moving' ? 'moving' : 'programmed F')),
    c.tool === null
      ? null
      : fz === null
        ? row('chip', 'Chip load', spindleOff ? 'None while the spindle is off' : 'Not known')
        : fz.verdict === 'ok'
          ? row('chip', 'Chip load', h('span', { class: 'insight-ok', 'data-verdict': 'ok', title: `In the band${rangeText}` }, `✓ ${n3(fz.value)} mm/tooth`))
          : // The warning takes the row's full width, so "⚠ light, rubbing risk (0.060–0.100)" stays on one line.
            h('li', { key: 'chip', 'data-insight-row': 'chip' }, h('span', { class: 'insight-label' }, 'Chip load'), h('span', { class: 'insight-value' }, `${n3(fz.value)} mm/tooth`), warn),
    c.tool === null
      ? null
      : c.surface === null
        ? row('surface', 'Surface speed', spindleOff ? 'None while the spindle is off' : 'Not known')
        : row('surface', 'Surface speed', `${n0(c.surface.value)} m/min`, c.surface.reference === null ? null : h('span', { class: 'insight-sub' }, c.surface.reference)),
    c.note === null ? null : h('li', { key: 'note', class: 'insight-note', 'data-insight-row': 'note' }, c.note),
    c.missing.map((m, i) =>
      h(
        'li',
        { key: `missing-${i}`, class: 'insight-missing', 'data-insight-row': 'missing' },
        h('span', null, m.text),
        m.fix === null ? null : h('button', { type: 'button', class: 'link', 'data-action': 'insight-fix', onClick: () => follow(m.fix as Fix) }, m.fix.label),
      ),
    ),
  );
}

export function MachineInsight({ model, fileTool = null }: { readonly model: WorkspaceModel | null; readonly fileTool?: number | null }): ComponentChild {
  const view = model?.live.value ?? null;
  if (view === null || !connected(view) || view.message === null) return null;
  const m = view.message;
  const snap = m.snapshot;
  const live = snap.live;
  const job = snap.job;
  const plannerBlocks = DIALECTS.find((d) => d.id === snap.classification?.dialectId)?.limits.plannerBlocks ?? null;
  const planner = plannerRows({ qr: typeof live.qr === 'number' ? live.qr : null, plannerBlocks, job });
  const materialId = activeJob.value?.setup.stock.materialRef.id ?? null;
  const speeds = job?.report?.speeds ?? [];
  const on = typeof live.spe === 'number' ? live.spe === 1 : typeof live.spc === 'number' ? live.spc !== 0 : null;
  const cutting = cuttingRows({
    toolNumber: typeof live.tool === 'number' ? live.tool : null,
    toolLive: live.srList?.includes('tool') === true,
    fileTool: job !== null && job.startedAt !== null && job.endedAt === null ? fileTool : null,
    tools: toolStore.value.value,
    materialId: materialId === '' ? null : materialId,
    material: materialId === null || materialId === '' ? null : material(materialId),
    vel: typeof live.vel === 'number' ? live.vel : null,
    feed: typeof live.feed === 'number' ? live.feed : null,
    sps: typeof live.sps === 'number' ? live.sps : null,
    spindleOn: on,
    fileSpeed: speeds.length === 1 ? (speeds[0] ?? null) : null,
    inches: m.dro.units === 'in',
  });
  return h(
    'section',
    { class: 'insp sec-insight', 'aria-label': 'Planner and cutting', 'data-insight': 'block' },
    h('h3', null, 'Planner'),
    plannerList(planner, ageText(view).text),
    h('h3', null, 'Cutting'),
    cuttingList(cutting),
  );
}
