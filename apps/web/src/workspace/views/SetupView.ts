/**
 * The Setup view: bed, stock and fixture (WORKSPACE_FEATURES "Workholding and
 * bed", "Stock and material"). A fixture outline can come from a DXF or SVG
 * file, parsed in this browser (workspace/outline.ts); the file never leaves
 * the computer. Kept in this browser through the library adapter.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { allMaterials, material, sampleFixture, setupStore, type SetupState } from '../library.ts';
import { Icon } from '../icons.ts';
import { OutlineError, parseOutline, MAX_OUTLINE_BYTES } from '../outline.ts';
import { SetupScene, type SetupCamera } from '../setupScene.ts';

type Stock = SetupState['stock'];

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

const ZEROS = ['back-left', 'back', 'back-right', 'left', 'center', 'right', 'front-left', 'front', 'front-right'] as const;

function Viewer({ setup }: { readonly setup: SetupState }): ComponentChild {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<SetupScene | null>(null);
  const [cam, setCam] = useState<SetupCamera>('iso');
  const [fit, setFit] = useState<'stock' | 'bed'>('stock');
  useEffect(() => {
    if (canvas.current === null) return;
    scene.current = new SetupScene(canvas.current);
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    scene.current?.update(setup, material(setup.stock.materialId)?.color ?? [196, 205, 212]);
  }, [setup]);
  const fixtureTop = setup.fixture?.height ?? 0;
  const stockTop = fixtureTop + setup.stock.thickness;
  const bedTop = setup.bed.thickness;
  return h(
    'div',
    { class: 'viewer setup-viewer' },
    h('canvas', { ref: canvas, role: 'img', 'aria-label': 'Bed, fixture, clamps and stock. Drag to orbit, scroll to zoom.' }),
    h(
      'div',
      { class: 'viewer-top' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Frame the view' }, (['stock', 'bed'] as const).map((f) => h('button', { type: 'button', key: f, class: fit === f ? 'selected' : undefined, onClick: () => { setFit(f); scene.current?.setFit(f); } }, f === 'stock' ? 'Stock' : 'Whole bed'))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Camera' }, (['iso', 'top', 'front'] as const).map((c) => h('button', { type: 'button', key: c, class: cam === c ? 'selected' : undefined, onClick: () => { setCam(c); scene.current?.setView(c); } }, c === 'iso' ? '3D' : c === 'top' ? 'Top' : 'Front'))),
    ),
    h(
      'div',
      { class: 'stack-diagram', 'aria-label': 'Heights above the machine table' },
      h('div', { class: 'stack-row s-stock' }, h('i', null), h('span', null, 'Stock top'), h('strong', null, (bedTop + stockTop).toFixed(2))),
      h('div', { class: 'stack-row s-fixture' }, h('i', null), h('span', null, 'Fixture top'), h('strong', null, (bedTop + fixtureTop).toFixed(2))),
      h('div', { class: 'stack-row s-bed' }, h('i', null), h('span', null, 'Bed top'), h('strong', null, bedTop.toFixed(2))),
      h('small', null, 'mm above the machine table'),
    ),
    h('p', { class: 'viewer-notice' }, 'An illustration of your setup, not a collision check.'),
  );
}

function FixtureThumb({ fixture }: { readonly fixture: NonNullable<SetupState['fixture']> }): ComponentChild {
  const w = Math.max(...fixture.outline.map((p) => p[0]), 1);
  const d = Math.max(...fixture.outline.map((p) => p[1]), 1);
  const path = fixture.outline.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${(d - p[1]).toFixed(1)}`).join('') + 'Z';
  return h('svg', { class: 'fixture-thumb', viewBox: `-6 -6 ${w + 12} ${d + 12}`, 'aria-hidden': 'true' }, h('path', { d: path, class: 'ol' }), ...fixture.holes.slice(0, 200).map(([x, y, r], i) => h('circle', { cx: x, cy: d - y, r: Math.max(r, w / 120), key: String(i) })));
}

export function SetupView(): ComponentChild {
  const setup = setupStore.value.value;
  const [status, setStatus] = useState('Reads lines, polylines, circles and rectangles. The file stays on this computer. Units are taken as millimetres.');
  const set = (patch: Partial<SetupState>): void => setupStore.set({ ...setup, ...patch });
  const setStock = (patch: Partial<Stock>): void => set({ stock: { ...setup.stock, ...patch } });
  const st = setup.stock;
  const fx = setup.fixture;
  const fits = fx === null || (st.shape === 'round' ? st.diameter : st.width) <= Math.max(...fx.outline.map((p) => p[0])) + 0.01;
  const mat = material(st.materialId);
  return h(
    'div',
    { class: 'setup-view' },
    h('div', { class: 'view-head' }, h('div', { class: 'title-block' }, h('h1', null, 'Workholding and stock'), h('p', null, 'What sits on the bed, how high, and where work zero is.'))),
    h(
      'div',
      { class: 'workspace-grid' },
      h('div', { class: 'canvas-column' }, h(Viewer, { setup })),
      h(
        'aside',
        { tabindex: 0, class: 'inspector', 'aria-label': 'Setup details' },
        h(
          'section',
          { class: 'insp' },
          h('header', null, h('h2', null, 'Stock'), h('span', { class: `tag${fits ? ' ok' : ' warn'}` }, fx === null ? 'On the bed' : fits ? 'Sits on the fixture' : 'Wider than the fixture')),
          h(
            'div',
            { class: 'shape-picker', role: 'group', 'aria-label': 'Stock shape' },
            (['block', 'round', 'sheet'] as const).map((shape) => h('button', { type: 'button', key: shape, class: st.shape === shape ? 'selected' : undefined, 'aria-pressed': st.shape === shape ? 'true' : 'false', onClick: () => setStock({ shape }) }, shape === 'block' ? 'Block' : shape === 'round' ? 'Round' : 'Sheet')),
          ),
          h('div', { class: 'field-grid' }, ...(st.shape === 'round' ? [field('Diameter', st.diameter, (diameter) => setStock({ diameter }))] : [field('Width X', st.width, (width) => setStock({ width })), field('Depth Y', st.depth, (depth) => setStock({ depth }))]), field('Thickness', st.thickness, (thickness) => setStock({ thickness }), 'mm', 0.05, 0.1)),
          h(
            'label',
            { class: 'field' },
            h('span', null, 'Material'),
            h(
              'span',
              { class: 'select-wrap' },
              h(
                'select',
                { value: st.materialId, onChange: (e: Event) => setStock({ materialId: (e.currentTarget as HTMLSelectElement).value }) },
                allMaterials.value.filter((m) => !m.doNotMachine).map((m) => h('option', { value: m.id, key: m.id }, m.name)),
              ),
            ),
          ),
          mat !== null && mat.safety.length > 0 ? h('ul', { class: 'safety-notes compact' }, mat.safety.map((s, i) => h('li', { key: String(i), class: s.level }, s.text))) : null,
          h('div', { class: 'field-grid' }, field('Position X', st.x, (x) => setStock({ x }), 'mm', 1, -10000), field('Position Y', st.y, (y) => setStock({ y }), 'mm', 1, -10000)),
          h(
            'div',
            { class: 'field' },
            h('span', null, 'Work zero'),
            h(
              'div',
              { class: 'zero-pick' },
              h('div', { class: 'zero-grid', role: 'radiogroup', 'aria-label': 'Work zero point on the stock' }, ZEROS.map((z) => h('button', { type: 'button', role: 'radio', key: z, 'aria-checked': st.zero === z ? 'true' : 'false', 'aria-label': z.replace('-', ' '), onClick: () => setStock({ zero: z }) }))),
              h('div', { class: 'seg vertical', role: 'group', 'aria-label': 'Zero height' }, (['top', 'bottom'] as const).map((zh) => h('button', { type: 'button', key: zh, class: st.zeroHeight === zh ? 'selected' : undefined, onClick: () => setStock({ zeroHeight: zh }) }, zh === 'top' ? 'Stock top' : 'Stock bottom'))),
            ),
          ),
        ),
        h(
          'section',
          { class: 'insp' },
          h('header', null, h('h2', null, 'Fixture'), h('span', { class: 'tag' }, fx === null ? 'None' : fx.kind === 'sample' ? 'Sample' : fx.kind.toUpperCase())),
          fx === null
            ? h('p', { class: 'fine' }, 'The stock sits straight on the bed.')
            : [
                h('div', { class: 'fixture-item', key: 'item' }, h(FixtureThumb, { fixture: fx }), h('div', null, h('strong', null, fx.name), h('small', null, `${fx.file ?? 'built in'} · ${Math.round(Math.max(...fx.outline.map((p) => p[0])))} × ${Math.round(Math.max(...fx.outline.map((p) => p[1])))} mm · ${fx.holes.length} holes`))),
                h('div', { class: 'field-grid three', key: 'dims' }, field('Height', fx.height, (height) => set({ fixture: { ...fx, height } })), field('X', fx.x, (x) => set({ fixture: { ...fx, x } }), 'mm', 1, -10000), field('Y', fx.y, (y) => set({ fixture: { ...fx, y } }), 'mm', 1, -10000)),
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
                  setStatus('That file is too large to read here (4 MB at most).');
                  return;
                }
                void file.text().then(
                  (text) => {
                    try {
                      const parsed = parseOutline(file.name, text);
                      set({ fixture: { name: file.name.replace(/\.[^.]+$/, ''), file: file.name, kind: /\.dxf$/i.test(file.name) ? 'dxf' : 'svg', outline: parsed.outline, holes: parsed.holes, height: fx?.height ?? 12, x: fx?.x ?? 160, y: fx?.y ?? 120 } });
                      setStatus(`Read ${file.name}: ${Math.round(parsed.width)} × ${Math.round(parsed.depth)} mm, ${parsed.holes.length} holes.`);
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
            h('span', null, h('strong', null, 'Add a fixture from DXF or SVG'), h('small', null, 'Outlines and holes become a solid at the height you set')),
          ),
          h('p', { class: 'fine', 'aria-live': 'polite', 'data-setup': 'upload-status' }, status),
          h(
            'div',
            { class: 'switch-row' },
            h('span', null, 'Toe clamps on the stock edges'),
            h('button', { type: 'button', class: 'toggle', 'aria-pressed': setup.clamps ? 'true' : 'false', onClick: () => set({ clamps: !setup.clamps }) }, setup.clamps ? '4 clamps' : 'No clamps'),
          ),
          h('div', { class: 'switch-row' }, h('span', null, 'Fixture'), h('button', { type: 'button', class: 'small', onClick: () => set({ fixture: fx === null ? sampleFixture() : null }) }, fx === null ? 'Use the sample plate' : 'Remove the fixture')),
        ),
        h(
          'section',
          { class: 'insp' },
          h('header', null, h('h2', null, 'Bed'), h('span', { class: 'tag' }, 'Spoilboard')),
          h('div', { class: 'field-grid three' }, field('Width', setup.bed.width, (width) => set({ bed: { ...setup.bed, width } }), 'mm', 1, 1), field('Depth', setup.bed.depth, (depth) => set({ bed: { ...setup.bed, depth } }), 'mm', 1, 1), field('Thickness', setup.bed.thickness, (thickness) => set({ bed: { ...setup.bed, thickness } }))),
          h('p', { class: 'fine' }, setupStore.saved.value ? 'Saved in this browser. Account sync comes later.' : 'Not saved: this browser blocks storage. Changes last for this page only.'),
        ),
      ),
    ),
  );
}
