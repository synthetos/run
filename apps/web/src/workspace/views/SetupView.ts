/**
 * The Setup view: the active job's machine, stock, fixture, clamps and bed
 * (WORKSPACE_FEATURES "Workholding and bed", "Stock and material";
 * FLOW_ANALYSIS §4). It edits the one Job record (workspace/jobModel.ts) the
 * Run view shows, and draws the one scene (preview/sceneModel.ts) with the
 * open file's path on it, through the same renderer as Run. A fixture
 * outline can come from a DXF or SVG file, parsed in this browser
 * (workspace/outline.ts); the file never leaves the computer.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { allMaterials, bedIsPlaceholder, bedOf, doNotMachine, machineStore, material, materialColor, SAMPLE_HASH, sampleFixture, saveMachineBed, selectedMachineStore, type MachineBed } from '../library.ts';
import { SafetyNotes } from './LibraryViews.ts';
import { Icon } from '../icons.ts';
import { OutlineError, parseOutline, MAX_OUTLINE_BYTES } from '../outline.ts';
import { activeJob, bedBehind, clampsAreIllustrative, illustrativeClamps, jobSaved, reviseJob, SEED_JOB, updateActiveJob, withDatum, withMachine, withSetup, type Job } from '../jobModel.ts';
import { currentPreview } from '../fileBridge.ts';
import { sha256Hex } from '../../projects/image.ts';
import { formatBytes } from '../../projects/limits.ts';
import { jobScene } from '../../preview/sceneModel.ts';
import { sceneColors, tokenReader } from '../../preview/colors.ts';
import { SceneView } from '../../preview/SceneView.ts';
import { TabBar, TabPane } from '../ui.ts';

type Stock = Job['setup']['stock'];

function field(label: string, value: number, onChange: (n: number) => void, unit = 'mm', step = 0.5, min = 0): ComponentChild {
  return h(
    'label',
    { class: 'field', key: label },
    h('span', null, label),
    h(
      'span',
      { class: 'unit-input' },
      h('input', {
        type: 'number',
        value,
        step,
        min,
        onChange: (e: Event) => {
          const n = Number.parseFloat((e.currentTarget as HTMLInputElement).value);
          if (Number.isFinite(n) && n >= min) onChange(n);
        },
      }),
      h('i', null, unit),
    ),
  );
}

const ZEROS = ['back-left', null, 'back-right', null, 'center', null, 'front-left', null, 'front-right'] as const;

/** The scene with the stack of heights and the camera buttons. */
function Viewer({ job, active }: { readonly job: Job; readonly active: boolean }): ComponentChild {
  const scene = jobScene(job, sceneColors(tokenReader()), materialColor(job.setup.stock.materialRef.id));
  const hts = scene.heights;
  const f = (n: number): string => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}`;
  return h(
    'div',
    { class: 'viewer setup-viewer' },
    h(SceneView, { scene, preview: currentPreview.value, active }),
    h(
      'div',
      { class: 'stack-diagram', 'aria-label': 'Heights of the top faces' },
      h('div', { class: 'stack-row s-stock' }, h('i', null), h('span', null, 'Stock top'), h('strong', { 'data-height': 'stock' }, f(hts.stockTop))),
      h('div', { class: 'stack-row s-fixture' }, h('i', null), h('span', null, 'Fixture top'), h('strong', { 'data-height': 'fixture' }, f(hts.fixtureTop))),
      h('div', { class: 'stack-row s-bed' }, h('i', null), h('span', null, 'Bed top'), h('strong', { 'data-height': 'bed' }, f(hts.bedTop))),
      h('small', null, `mm, machine Z${scene.bedPlaceholder ? ' (bed height is a placeholder)' : ''}. Above the table: stock ${hts.aboveTable.stockTop.toFixed(2)}, fixture ${hts.aboveTable.fixtureTop.toFixed(2)}, bed ${hts.aboveTable.bedTop.toFixed(2)}.`),
    ),
    h('p', { class: 'viewer-notice' }, 'An illustration of your setup with the file’s path at the planned work zero, not a collision check.'),
  );
}

export function FixtureThumb({ outline, holes }: { readonly outline: readonly (readonly [number, number])[]; readonly holes: readonly (readonly [number, number, number])[] }): ComponentChild {
  const w = Math.max(...outline.map((p) => p[0]), 1);
  const d = Math.max(...outline.map((p) => p[1]), 1);
  const path = outline.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${(d - p[1]).toFixed(1)}`).join('') + 'Z';
  return h('svg', { class: 'fixture-thumb', viewBox: `-6 -6 ${w + 12} ${d + 12}`, 'aria-hidden': 'true' }, h('path', { d: path, class: 'ol' }), ...holes.slice(0, 200).map(([x, y, r], i) => h('circle', { cx: x, cy: d - y, r: Math.max(r, w / 120), key: String(i) })));
}

type SetupTab = 'stock' | 'fixture' | 'bed';

function bedSourceText(bed: MachineBed): string {
  const s = bed.source;
  if (s.kind === 'placeholder') return `Placeholder: ${s.note}`;
  if (s.kind === 'measured') return `Measured: ${s.note}`;
  return `From ${s.file} (${s.units}${s.scale === 1 ? '' : `, scale ${s.scale}`}).`;
}

export function SetupView({ active = true }: { readonly active?: boolean }): ComponentChild {
  const job = activeJob.value ?? SEED_JOB;
  const [tab, setTab] = useState<SetupTab>('stock');
  const [status, setStatus] = useState(`Reads lines, polylines, circles and rectangles. The file stays on this computer. Units are taken as millimetres; up to ${formatBytes(MAX_OUTLINE_BYTES)}.`);
  const [bedNote, setBedNote] = useState<string | null>(null);
  const setup = (patch: Partial<Job['setup']>): void => void updateActiveJob((j) => withSetup(j, patch));
  const setStock = (patch: Partial<Stock>): void => setup({ stock: { ...job.setup.stock, ...patch } });
  const st = job.setup.stock;
  const fx = job.setup.fixture;
  const fits = fx === null || (st.shape === 'round' ? (st.diameter ?? st.width) : st.width) <= Math.max(...fx.outline.map((p) => p[0])) + 0.01;
  const mat = material(st.materialRef.id);
  const machines = machineStore.value.value;
  const machine = job.machine === null ? null : (machines.find((m) => m.id === job.machine?.id) ?? null);
  const behind = bedBehind(job, machine);
  const bed = job.setup.bed;
  const setBed = (patch: Partial<Pick<MachineBed, 'width' | 'depth' | 'thickness'>> & { readonly z?: number }): void => {
    const { z, ...dims } = patch;
    const at = new Date().toISOString();
    setup({ bed: { ...bed, ...dims, toMachine: z === undefined ? bed.toMachine : { ...bed.toMachine, z }, source: { kind: 'measured', note: 'Entered in Setup.', at } } });
  };
  return h(
    'div',
    { class: 'setup-view' },
    h(
      'div',
      { class: 'view-head' },
      h('div', { class: 'title-block' }, h('h1', null, 'Workholding and stock'), h('p', null, h('span', { 'data-setup': 'job-name' }, job.name), job.file === null ? ' · no file open' : ` · ${job.file.name}`, ' · what sits on the bed, how high, and where work zero is.')),
      h(
        'div',
        { class: 'view-actions' },
        h(
          'label',
          { class: 'field inline' },
          h('span', null, 'Machine'),
          h(
            'span',
            { class: 'select-wrap' },
            h(
              'select',
              {
                'aria-label': 'Machine for this job',
                'data-setup': 'machine',
                value: job.machine?.id ?? '',
                onChange: (e: Event) => {
                  const id = (e.currentTarget as HTMLSelectElement).value;
                  const m = machines.find((x) => x.id === id) ?? null;
                  updateActiveJob((j) => withMachine(j, m));
                  if (m !== null) selectedMachineStore.set(m.id);
                },
              },
              h('option', { value: '' }, machines.length === 0 ? 'No machine yet (Machines view)' : 'No machine: the draft’s own bed'),
              machines.map((m) => h('option', { key: m.id, value: m.id }, m.name)),
            ),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'workspace-grid' },
      h('div', { class: 'canvas-column' }, h(Viewer, { job, active })),
      h(
        'aside',
        { class: 'inspector tabbed', 'aria-label': 'Setup details' },
        h(TabBar<SetupTab>, { label: 'Setup', prefix: 'setup', variant: 'underline', current: tab, onSelect: setTab, tabs: [{ id: 'stock', label: 'Stock' }, { id: 'fixture', label: 'Fixture' }, { id: 'bed', label: 'Bed' }] }),
        h(
          TabPane,
          { prefix: 'setup', id: 'stock', current: tab, class: 'tpane insp-scroll' },
          h(
            'section',
            { class: 'insp' },
            h('header', null, h('h2', null, 'Stock'), h('span', { class: `tag${fits ? ' ok' : ' warn'}` }, fx === null ? 'On the bed' : fits ? 'Sits on the fixture' : 'Wider than the fixture')),
            job.setup.stockOutline === null
              ? h(
                  'div',
                  { class: 'shape-picker', role: 'group', 'aria-label': 'Stock shape' },
                  (['block', 'round', 'sheet'] as const).map((shape) => h('button', { type: 'button', key: shape, class: st.shape === shape ? 'selected' : undefined, 'aria-pressed': st.shape === shape ? 'true' : 'false', onClick: () => setStock({ shape }) }, shape === 'block' ? 'Block' : shape === 'round' ? 'Round' : 'Sheet')),
                )
              : h('div', { class: 'fixture-item', 'data-setup': 'stock-outline' }, h(FixtureThumb, { outline: job.setup.stockOutline.outline, holes: job.setup.stockOutline.holes }), h('div', null, h('strong', null, 'Outline from a drawing'), h('small', null, `${job.setup.stockOutline.source.file} · ${Math.round(st.width)} × ${Math.round(st.depth)} mm`), h('button', { type: 'button', class: 'small quiet-link', 'data-action': 'stock-outline-remove', onClick: () => setup({ stockOutline: null }) }, 'Use a plain shape instead'))),
            h('div', { class: 'field-grid' }, ...(st.shape === 'round' ? [field('Diameter', st.diameter ?? st.width, (diameter) => setStock({ diameter }))] : [field('Width X', st.width, (width) => setStock({ width })), field('Depth Y', st.depth, (depth) => setStock({ depth }))]), field('Thickness', st.thickness, (thickness) => setStock({ thickness }), 'mm', 0.05, 0.1)),
            h(
              'label',
              { class: 'field' },
              h('span', null, 'Material'),
              h(
                'span',
                { class: 'select-wrap' },
                h(
                  'select',
                  {
                    value: st.materialRef.id,
                    onChange: (e: Event) => {
                      const m = material((e.currentTarget as HTMLSelectElement).value);
                      if (m !== null) setStock({ materialRef: { id: m.id, version: m.version } });
                    },
                  },
                  allMaterials.value.filter((v) => !doNotMachine(v.material)).map((v) => h('option', { value: v.material.id, key: v.material.id }, v.material.name)),
                ),
              ),
            ),
            mat === null ? null : h(SafetyNotes, { m: mat, compact: true }),
            h('div', { class: 'field-grid' }, field('Centre X', st.position.x, (x) => setStock({ position: { ...st.position, x } }), 'mm', 1, -10000), field('Centre Y', st.position.y, (y) => setStock({ position: { ...st.position, y } }), 'mm', 1, -10000)),
            h('p', { class: 'fine' }, 'Positions are the centre of the footprint, from the bed’s front-left corner (bed coordinates).'),
            h(
              'div',
              { class: 'field' },
              h('span', null, 'Work zero (the file’s datum)'),
              h(
                'div',
                { class: 'zero-pick' },
                h('div', { class: 'zero-grid', role: 'radiogroup', 'aria-label': 'Work zero point on the stock' }, ZEROS.map((z, i) => (z === null ? h('span', { key: String(i), 'aria-hidden': 'true' }) : h('button', { type: 'button', role: 'radio', key: z, 'aria-checked': job.placement.datum.corner === z ? 'true' : 'false', 'aria-label': z.replace('-', ' '), onClick: () => updateActiveJob((j) => withDatum(j, { ...j.placement.datum, corner: z })) })))),
                h('div', { class: 'seg vertical', role: 'group', 'aria-label': 'Zero height' }, (['top', 'bottom'] as const).map((zh) => h('button', { type: 'button', key: zh, class: job.placement.datum.height === zh ? 'selected' : undefined, onClick: () => updateActiveJob((j) => withDatum(j, { ...j.placement.datum, height: zh })) }, zh === 'top' ? 'Stock top' : 'Stock bottom'))),
              ),
            ),
            h('p', { class: 'fine' }, 'Says where the CAM file’s zero sits on the stock; it does not prove the file was programmed that way. The path is drawn there.'),
          ),
        ),
        h(
          TabPane,
          { prefix: 'setup', id: 'fixture', current: tab, class: 'tpane insp-scroll' },
          h(
            'section',
            { class: 'insp' },
            h('header', null, h('h2', null, 'Fixture'), h('span', { class: 'tag' }, fx === null ? 'None' : fx.source.hash === SAMPLE_HASH ? 'Sample' : fx.source.kind.toUpperCase())),
            fx === null
              ? h('p', { class: 'fine' }, 'The stock sits straight on the bed.')
              : [
                  h('div', { class: 'fixture-item', key: 'item' }, h(FixtureThumb, { outline: fx.outline, holes: fx.holes }), h('div', null, h('strong', null, fx.name), h('small', null, `${fx.source.hash === SAMPLE_HASH ? 'built in' : fx.source.file} · ${Math.round(Math.max(...fx.outline.map((p) => p[0])))} × ${Math.round(Math.max(...fx.outline.map((p) => p[1])))} mm · ${fx.holes.length} holes`))),
                  h('div', { class: 'field-grid three', key: 'dims' }, field('Height', fx.height, (height) => setup({ fixture: { ...fx, height } })), field('Centre X', fx.position.x, (x) => setup({ fixture: { ...fx, position: { ...fx.position, x } } }), 'mm', 1, -10000), field('Centre Y', fx.position.y, (y) => setup({ fixture: { ...fx, position: { ...fx.position, y } } }), 'mm', 1, -10000)),
                ],
            h(
              'label',
              { class: 'upload' },
              h('input', {
                type: 'file',
                accept: '.dxf,.svg,image/svg+xml',
                'data-action': 'fixture-file',
                onChange: (e: Event) => {
                  const input = e.currentTarget as HTMLInputElement;
                  const file = input.files?.[0];
                  if (file === undefined) return;
                  if (file.size > MAX_OUTLINE_BYTES) {
                    setStatus(`That file is too large to read here (${formatBytes(MAX_OUTLINE_BYTES)} at most).`);
                    return;
                  }
                  void file.arrayBuffer().then(
                    async (bytes) => {
                      try {
                        const text = new TextDecoder().decode(bytes);
                        const parsed = parseOutline(file.name, text);
                        const hash = await sha256Hex(bytes);
                        setup({
                          fixture: {
                            id: `fixture.${hash.slice(0, 16)}`,
                            name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Fixture',
                            source: { file: file.name.slice(0, 120), kind: /\.dxf$/i.test(file.name) ? 'dxf' : 'svg', hash },
                            outline: parsed.outline.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as const),
                            holes: parsed.holes.map(([x, y, r]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(r * 1000) / 1000] as const),
                            height: fx?.height ?? 12,
                            position: fx?.position ?? { x: 160, y: 120 },
                            material: fx?.material ?? 'Not recorded',
                          },
                        });
                        const skipped = Object.entries(parsed.skipped);
                        setStatus(`Read ${file.name}: ${Math.round(parsed.width)} × ${Math.round(parsed.depth)} mm, ${parsed.holes.length} holes.${skipped.length === 0 ? '' : ` Not read: ${skipped.map(([k, n]) => `${n} ${k}`).join(', ')}.`}`);
                      } catch (error) {
                        setStatus(error instanceof OutlineError ? error.message : 'The file could not be read.');
                      }
                    },
                    () => setStatus('The file could not be read.'),
                  );
                  input.value = '';
                },
              }),
              Icon('upload', 22),
              h('span', null, h('strong', null, 'Add a fixture from DXF or SVG'), h('small', null, 'Outlines and holes become a solid at the height you set. A drawing in a project: Projects → Use in Job.')),
            ),
            h('p', { class: 'fine', 'aria-live': 'polite', 'data-setup': 'upload-status' }, status),
            h(
              'div',
              { class: 'switch-row' },
              h('span', null, 'Toe clamps on the stock edges (illustrative)'),
              h('button', { type: 'button', class: 'toggle', 'aria-pressed': job.setup.clamps.length > 0 ? 'true' : 'false', onClick: () => setup({ clamps: job.setup.clamps.length > 0 ? [] : illustrativeClamps(st) }) }, job.setup.clamps.length > 0 ? `${job.setup.clamps.length} clamps${clampsAreIllustrative(job.setup.clamps) ? '' : ' (placed)'}` : 'No clamps'),
            ),
            h('div', { class: 'switch-row' }, h('span', null, 'Fixture'), h('button', { type: 'button', class: 'small', onClick: () => setup({ fixture: fx === null ? sampleFixture() : null }) }, fx === null ? 'Use the sample plate' : 'Remove the fixture')),
          ),
        ),
        h(
          TabPane,
          { prefix: 'setup', id: 'bed', current: tab, class: 'tpane insp-scroll' },
          h(
            'section',
            { class: 'insp', 'data-setup': 'bed' },
            h('header', null, h('h2', null, 'Bed'), h('span', { class: `tag${bedIsPlaceholder(bed) ? ' warn' : ' ok'}`, 'data-bed': bedIsPlaceholder(bed) ? 'placeholder' : bed.source.kind }, bedIsPlaceholder(bed) ? 'Placeholder' : bed.source.kind === 'measured' ? 'Measured' : 'From a drawing')),
            h('p', { class: 'fine', 'data-bed': 'owner' }, job.machine === null || job.setup.bedFrom === 'own' ? 'The draft’s own bed: no machine is chosen. Choose a machine above to plan on its bed.' : `Pinned from ${job.machine.name}, bed revision ${bed.revision}${behind ? ` (the machine now has revision ${machine === null ? '?' : bedOf(machine).revision})` : ''}.`),
            behind && machine !== null ? h('button', { type: 'button', class: 'small', 'data-action': 'job-take-bed', onClick: () => updateActiveJob((j) => withMachine(j, machine)) }, `Use the machine’s bed revision ${bedOf(machine).revision}`) : null,
            h('p', { class: 'fine' }, bedSourceText(bed)),
            h('div', { class: 'field-grid three' }, field('Width', bed.width, (width) => setBed({ width }), 'mm', 1, 1), field('Depth', bed.depth, (depth) => setBed({ depth }), 'mm', 1, 1), field('Thickness', bed.thickness, (thickness) => setBed({ thickness }))),
            h('div', { class: 'field-grid' }, field('Bed top, machine Z', bed.toMachine.z, (z) => setBed({ z }), 'mm', 0.1, -100000)),
            h('p', { class: 'fine' }, 'Bed coordinates start at the front-left corner of the bed’s top; this says where that corner sits in machine coordinates (X and Y at 0 for a machine homed at the front-left).'),
            bed.outline === null ? null : h('p', { class: 'fine' }, `Outline from a drawing: ${bed.outline.length} points, ${bed.holes.length} holes.`),
            job.machine !== null && machine !== null
              ? h('button', { type: 'button', class: 'small', 'data-action': 'bed-save-machine', onClick: () => {
                  const saved = saveMachineBed(machine.id, { width: bed.width, depth: bed.depth, thickness: bed.thickness, outline: bed.outline, holes: bed.holes, toMachine: bed.toMachine, source: bed.source });
                  if (saved === null) setBedNote('The machine no longer exists.');
                  else {
                    const m = machineStore.value.value.find((x) => x.id === machine.id) ?? null;
                    updateActiveJob((j) => reviseJob(withMachine(j, m), {}));
                    setBedNote(`Saved to ${machine.name} as bed revision ${saved.revision}. Other jobs keep the revision they were planned on.`);
                  }
                } }, `Save to ${machine.name} as bed revision ${bedOf(machine).revision + 1}`)
              : null,
            bedNote === null ? null : h('p', { class: 'fine', role: 'status', 'data-bed': 'note' }, bedNote),
            h('p', { class: 'fine' }, jobSaved.value ? 'Saved in this browser. Account sync comes later.' : 'Not saved: this browser blocks storage. Changes last for this page only.'),
          ),
        ),
      ),
    ),
  );
}
