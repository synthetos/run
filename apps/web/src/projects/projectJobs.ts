/** Project jobs and explicit drawing import into the active job. */
import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { executionLock, openProjectJob } from '../workspace/fileBridge.ts';
import { Icon } from '../workspace/icons.ts';
import { activeJob, type Job } from '../workspace/jobModel.ts';
import { uiLevel } from '../workspace/jobWorkflow.ts';
import { bedSizeText } from '../workspace/revisionWords.ts';
import { FixtureThumb } from '../workspace/views/SetupView.ts';
import { withProjects as act, projectStore } from './browserStore.ts';
import { type Project } from './store.ts';
import { applyImport, checkDrawing, JOB_ROLE_LABEL, scaled, skippedText, type ImportCheck, type Units } from './useInJob.ts';

import { dateText, type ImportRequest } from './projectMedia.ts';
export function DrawingImport({ request, onDone }: { readonly request: ImportRequest; readonly onDone: (text: string | null) => void }): ComponentChild {
  const { file, role } = request;
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [units, setUnits] = useState<Units>('mm');
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(initialHeight(role));
  const [bedTopZ, setBedTopZ] = useState(() => activeJob.value?.setup.bed.toMachine.z ?? 0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void projectStore()
      .then((s) => s.blob(file.id))
      .then(async (b) => {
        if (!live) return;
        if (b === null) setCheck({ ok: false, reason: 'The file is no longer stored in this browser.' });
        else setCheck(checkDrawing(file, new TextDecoder().decode(await b.arrayBuffer())));
      });
    return () => {
      live = false;
    };
  }, [file.id]);
  const parsed = check?.ok === true ? scaled(check.parsed, units, scale) : null;
  const num = (e: Event, min: number): number | null => {
    const n = Number.parseFloat((e.currentTarget as HTMLInputElement).value);
    return Number.isFinite(n) && n >= min ? n : null;
  };
  return h(
    'div',
    { class: 'panel drawing-import', 'data-project': 'import', 'data-import-role': role, role: 'region', 'aria-label': `Use ${file.name} as ${JOB_ROLE_LABEL[role]}` },
    h('div', { class: 'panel-head' }, h('h3', null, `Use ${file.name} as ${drawingLabel(role)}`)),
    check === null
      ? h('p', { class: 'fine' }, 'Reading the drawing…')
      : !check.ok
        ? h('p', { class: 'fine tone-warn', role: 'alert', 'data-import': 'refused' }, check.reason)
        : parsed === null
          ? null
          : [
              h('div', { class: 'fixture-item', key: 'geom' }, h(FixtureThumb, { outline: parsed.outline, holes: parsed.holes }), h('div', null, h('strong', { 'data-import': 'size' }, `${Math.round(parsed.width)} × ${Math.round(parsed.depth)} mm`), h('small', null, `${parsed.outline.length} outline points · ${parsed.holes.length} holes · read as ${units === 'mm' ? 'millimetres' : 'inches'}${scale === 1 ? '' : ` × ${scale}`}`), skippedText(parsed) === '' ? null : h('small', { class: 'tone-warn', 'data-import': 'skipped' }, skippedText(parsed)))),
              h(
                'div',
                { class: 'field-grid three', key: 'fields' },
                h('label', { class: 'field' }, h('span', null, 'Drawing units'), h('span', { class: 'select-wrap' }, h('select', { 'aria-label': 'Drawing units', 'data-import': 'units', value: units, onChange: (e: Event) => setUnits((e.currentTarget as HTMLSelectElement).value as Units) }, h('option', { value: 'mm' }, 'mm'), h('option', { value: 'in' }, 'inches')))),
                h('label', { class: 'field' }, h('span', null, 'Scale'), h('span', { class: 'unit-input' }, h('input', { type: 'number', step: 0.001, min: 0.001, value: scale, 'data-import': 'scale', onInput: (e: Event) => { const n = num(e, 0.001); if (n !== null) setScale(n); } }), h('i', null, '×'))),
                h('label', { class: 'field' }, h('span', null, heightLabel(role)), h('span', { class: 'unit-input' }, h('input', { type: 'number', step: 0.1, min: 0.1, value: height, 'data-import': 'height', onInput: (e: Event) => { const n = num(e, 0.1); if (n !== null) setHeight(n); } }), h('i', null, 'mm'))),
                role !== 'bed' ? null : h('label', { class: 'field' }, h('span', null, 'Bed top, machine Z'), h('span', { class: 'unit-input' }, h('input', { type: 'number', step: 0.1, value: bedTopZ, 'data-import': 'bed-top', onInput: (e: Event) => { const n = num(e, -100000); if (n !== null) setBedTopZ(n); } }), h('i', null, 'mm'))),
              ),
              h('p', { class: 'fine', key: 'note' }, 'Measure one thing on the part. Check it matches the size above before you accept.'),
            ],
    error === null ? null : h('p', { class: 'fine tone-warn', role: 'alert', 'data-import': 'error' }, error),
    h(
      'div',
      { class: 'edit-actions' },
      h('button', { type: 'button', class: 'small', 'data-action': 'import-cancel', onClick: () => onDone(null) }, 'Cancel'),
      h(
        'button',
        {
          type: 'button',
          class: 'small primary',
          'data-action': 'import-accept',
          disabled: check === null || !check.ok,
          onClick: () => {
            if (check === null || !check.ok) return;
            const r = applyImport(role, file, check, { units, scale, height, bedTopZ });
            if (r.ok) onDone(r.text);
            else setError(r.reason);
          },
        },
        'Accept',
      ),
    ),
  );
}

export function JobRow({ project, job, onView }: { readonly project: Project; readonly job: Job; readonly onView: (v: string) => void }): ComponentChild {
  const [error, setError] = useState<string | null>(null);
  const file = project.files.find((f) => f.id === job.file?.fileId);
  const current = activeJob.value?.id === job.id;
  return h(
    'li',
    { class: 'file-row job-row', 'data-project-job': job.name, 'aria-current': current ? 'true' : undefined },
    h('span', { class: 'file-icon', 'aria-hidden': 'true' }, Icon('run', 18)),
    h(
      'div',
      { class: 'file-name' },
      h('strong', null, job.name, current ? h('span', { class: 'tag ok' }, 'Open') : null),
      h('small', null, `${file === undefined ? (job.file === null ? 'no file' : `${job.file.name} (file removed)`) : file.name} · ${job.machine === null ? 'no machine' : uiLevel.value.value === 'advanced' ? `${job.machine.name}, bed revision ${job.setup.bed.revision}${job.setup.bed.source.kind === 'placeholder' ? ' (placeholder)' : ''}` : `${job.machine.name}, bed ${bedSizeText(job.setup.bed)}`}${uiLevel.value.value === 'advanced' ? ` · revision ${job.revision}` : ''} · changed ${dateText(job.updatedAt)}`),
      error === null ? null : h('small', { class: 'tone-warn', role: 'alert' }, error),
    ),
    h(
      'div',
      { class: 'row-actions' },
      h('button', { type: 'button', class: 'small', 'data-action': 'project-open-job', disabled: file === undefined || executionLock.value !== null, onClick: () => void openProjectJob(project.id, job.id).then((r) => { if (r.ok) onView('job'); else setError(r.reason); }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'The job could not be opened.')) }, Icon('run', 14), 'Open job'),
      h('button', { type: 'button', class: 'small icon-button quiet', 'aria-label': `Remove the job ${job.name}`, 'data-action': 'project-remove-job', onClick: () => void act((s) => s.removeJob(project.id, job.id)) }, Icon('trash', 15)),
    ),
  );
}


const initialHeight = (role: ImportRequest['role']): number => role === 'bed' ? 19 : role === 'stock' ? 6.35 : 12;
const drawingLabel = (role: ImportRequest['role']): string => role === 'bed' ? 'the bed drawing' : role === 'stock' ? 'the stock outline' : 'the fixture';
const heightLabel = (role: ImportRequest['role']): string => role === 'bed' ? 'Thickness' : role === 'stock' ? 'Stock thickness' : 'Fixture height';
