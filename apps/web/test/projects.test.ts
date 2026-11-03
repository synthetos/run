/**
 * Projects, Stage 1 (local): the limits (50 MB G-code, 20 MB other files,
 * 10 MB per image before re-encoding, 500 MB per project), the store over
 * the storage module's record store (create, rename, delete, files with
 * roles and notes, images re-encoded, links through safeExternalLink, setup
 * references), and the safe description renderer.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { blocks, Description } from '../src/projects/description.ts';
import { checkEncoded, checkFile, checkImage, classify, fitWithin, formatBytes, isGcodeFile, LIMITS, MB } from '../src/projects/limits.ts';
import { isProject, ProjectStore, projectUsage, type EncodedImage, type ProjectDeps } from '../src/projects/store.ts';
import { memoryRecordStore } from '../src/workspace/storage.ts';

describe('project limits', () => {
  it('are the design’s numbers', () => {
    expect(LIMITS).toEqual({ gcode: 50 * MB, other: 20 * MB, imageBeforeEncode: 10 * MB, project: 500 * MB });
  });

  it('classifies files by extension and images by type', () => {
    for (const n of ['a.nc', 'a.gcode', 'a.NGC', 'a.tap', 'a.txt', 'a.cnc', 'a.CNC']) expect(classify(n), n).toBe('gcode');
    expect(isGcodeFile({ name: 'old-upload.cnc', role: 'other' })).toBe(true);
    expect(isGcodeFile({ name: 'notes.pdf', role: 'other' })).toBe(false);
    expect(classify('fixture.dxf')).toBe('drawing');
    expect(classify('part.svg')).toBe('drawing');
    expect(classify('part.STEP')).toBe('model');
    expect(classify('part.stl')).toBe('model');
    expect(classify('photo.JPG')).toBe('image');
    expect(classify('blob', 'image/png')).toBe('image');
    expect(classify('notes.pdf')).toBe('other');
    expect(classify('.nc')).toBe('other');
  });

  it('50 MB per G-code file, 20 MB per other file, at the boundary', () => {
    expect(checkFile('a.nc', 50 * MB, 'gcode', 0)).toEqual({ ok: true });
    expect(checkFile('a.nc', 50 * MB + 1, 'gcode', 0).ok).toBe(false);
    expect(checkFile('a.pdf', 20 * MB, 'other', 0)).toEqual({ ok: true });
    expect(checkFile('a.pdf', 20 * MB + 1, 'other', 0).ok).toBe(false);
    expect(checkFile('a.stl', 30 * MB, 'model', 0).ok).toBe(false);
    const refused = checkFile('big.nc', 51 * MB, 'gcode', 0);
    expect(refused.ok === false && refused.reason).toBe('big.nc is 51 MB; G-code files can be up to 50 MB.');
  });

  it('500 MB per project, counting what is already stored', () => {
    expect(checkFile('a.nc', 10 * MB, 'gcode', 490 * MB)).toEqual({ ok: true });
    const over = checkFile('a.nc', 10 * MB + 1, 'gcode', 490 * MB);
    expect(over.ok).toBe(false);
    expect(over.ok === false && over.reason).toContain('10 MB is left');
    expect(checkEncoded('p.webp', MB, 499.5 * MB).ok).toBe(false);
  });

  it('10 MB per image before re-encoding, and at most 2000 px after', () => {
    expect(checkImage('p.jpg', 10 * MB)).toEqual({ ok: true });
    expect(checkImage('p.jpg', 10 * MB + 1).ok).toBe(false);
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(1000, 6000)).toEqual({ width: 333, height: 2000 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 kB');
    expect(formatBytes(500 * MB)).toBe('500 MB');
  });
});

function harness(encode?: (b: Blob) => Promise<EncodedImage>) {
  const records = memoryRecordStore();
  let n = 0;
  let clock = Date.parse('2026-11-02T10:00:00Z');
  const deps: ProjectDeps = {
    records,
    now: () => new Date((clock += 1000)),
    newId: () => `id-${++n}`,
    hash: (bytes) => Promise.resolve(`h${bytes.byteLength}`),
    encodeImage: encode ?? ((b) => Promise.resolve({ blob: new Blob([new Uint8Array(Math.ceil(b.size / 4))], { type: 'image/webp' }), width: 2000, height: 1500 })),
  };
  return { records, store: new ProjectStore(deps) };
}

/** A file whose `size` is what the limits see, without allocating it. */
function sized(name: string, size: number, type = ''): File {
  const f = new File(['G0 X1\n'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('the project store (IndexedDB through the storage module; in memory here)', () => {
  it('creates, renames, lists newest first, reloads and deletes', async () => {
    const { store, records } = harness();
    const a = await store.create('  Bracket   v2 ');
    expect(a.name).toBe('Bracket v2');
    const b = await store.create('');
    expect(b.name).toBe('Untitled project');
    expect(store.list.map((p) => p.id)).toEqual([b.id, a.id]);
    await store.rename(a.id, 'Bracket v3');
    expect(store.list[0]?.name).toBe('Bracket v3');
    await expect(store.rename(a.id, '   ')).rejects.toThrow('A project needs a name.');
    const again = new ProjectStore({ records, now: () => new Date(), newId: () => 'x', hash: () => Promise.resolve(''), encodeImage: () => Promise.reject(new Error('no')) });
    await again.load();
    expect(again.list.map((p) => p.name).sort()).toEqual(['Bracket v3', 'Untitled project']);
    await store.remove(b.id);
    expect(await records.keys('projects')).toEqual([a.id]);
  });

  it('adds files with a role from the extension, a hash and a note; refuses files over the limits', async () => {
    const { store, records } = harness();
    const p = await store.create('Plate');
    const r = await store.add(p.id, [new File(['G0 X1\nG1 X2\n'], 'plate.nc'), new File(['0\nSECTION'], 'plate.dxf'), sized('huge.nc', 51 * MB), sized('manual.pdf', 21 * MB)]);
    expect(r.added).toEqual(['plate.nc', 'plate.dxf']);
    expect(r.refused).toHaveLength(2);
    expect(r.refused[0]).toContain('G-code files can be up to 50 MB');
    expect(r.refused[1]).toContain('files other than G-code can be up to 20 MB');
    const saved = store.find(p.id);
    expect(saved?.files.map((f) => [f.name, f.role, f.hash])).toEqual([
      ['plate.nc', 'gcode', 'h12'],
      ['plate.dxf', 'drawing', 'h9'],
    ]);
    const gcode = saved?.files[0];
    expect(await (await store.blob(gcode?.id ?? ''))?.text()).toBe('G0 X1\nG1 X2\n');
    await store.updateFile(p.id, gcode?.id ?? '', { note: 'Second op, after the flip', role: 'other' });
    expect(store.find(p.id)?.files[0]).toMatchObject({ note: 'Second op, after the flip', role: 'other' });
    await store.removeFile(p.id, gcode?.id ?? '');
    expect(await records.get('blobs', gcode?.id ?? '')).toBeUndefined();
    expect(store.find(p.id)?.files.map((f) => f.name)).toEqual(['plate.dxf']);
  });

  it('keeps every project under 500 MB, counting files and images', async () => {
    const { store } = harness();
    const p = await store.create('Big');
    const files = Array.from({ length: 10 }, (_, i) => sized(`part-${i}.nc`, 49 * MB));
    const r = await store.add(p.id, files);
    expect(r.added).toHaveLength(10);
    expect(projectUsage(store.find(p.id) as never)).toBe(490 * MB);
    const more = await store.add(p.id, [sized('one-more.nc', 11 * MB)]);
    expect(more.added).toEqual([]);
    expect(more.refused[0]).toContain('past 500 MB');
  });

  it('re-encodes images (never storing the original), makes the first the cover, and refuses images over 10 MB', async () => {
    const seen: number[] = [];
    const { store, records } = harness((b) => {
      seen.push(b.size);
      return Promise.resolve({ blob: new Blob([new Uint8Array(1000)], { type: 'image/webp' }), width: 2000, height: 1333 });
    });
    const p = await store.create('Photos');
    const r = await store.add(p.id, [sized('IMG_0001.JPG', 4 * MB, 'image/jpeg'), sized('raw.png', 11 * MB, 'image/png'), sized('IMG_0002.jpeg', 2 * MB)]);
    expect(r.added).toEqual(['IMG_0001.webp', 'IMG_0002.webp']);
    expect(r.refused[0]).toContain('images can be up to 10 MB');
    expect(seen).toEqual([4 * MB, 2 * MB]);
    const saved = store.find(p.id);
    expect(saved?.images.map((i) => [i.size, i.width, i.height])).toEqual([
      [1000, 2000, 1333],
      [1000, 2000, 1333],
    ]);
    expect(saved?.cover).toBe(saved?.images[0]?.id);
    const stored = (await records.get('blobs', saved?.images[0]?.id ?? '')) as Blob;
    expect(stored.type).toBe('image/webp');
    await store.setCover(p.id, saved?.images[1]?.id ?? '');
    await store.removeImage(p.id, saved?.images[1]?.id ?? '');
    expect(store.find(p.id)?.cover).toBe(saved?.images[0]?.id);
  });

  it('an image the browser cannot decode is refused, not stored', async () => {
    const { store, records } = harness(() => Promise.reject(new Error('decode')));
    const p = await store.create('X');
    const r = await store.add(p.id, [sized('broken.png', 100, 'image/png')]);
    expect(r.refused).toEqual(['broken.png could not be read as an image.']);
    expect(await records.keys('blobs')).toEqual([]);
  });

  it('links go through safeExternalLink: http(s) only', async () => {
    const { store } = harness();
    const p = await store.create('Links');
    await store.addLink(p.id, 'Drawing', 'https://example.com/drawing');
    await expect(store.addLink(p.id, 'Bad', 'javascript:alert(1)')).rejects.toThrow(/web addresses/);
    await expect(store.addLink(p.id, 'Bad', 'data:text/html,x')).rejects.toThrow(/web addresses/);
    expect(store.find(p.id)?.links.map((l) => l.url)).toEqual(['https://example.com/drawing']);
  });

  it('records the machine, stock, material and tools used, by id and version', async () => {
    const { store } = harness();
    const p = await store.create('Setup');
    await store.setSetup(p.id, { machine: { id: 'm1', name: 'Shapeoko' }, stock: { id: 'setup.stock', name: 'Block 180 × 120 × 6.35 mm' }, material: { id: 'builtin.al-6061', version: 1, name: 'Aluminium 6061-T6' }, tools: [{ id: 'seed.t1', version: 1, name: '3.175 mm 2-flute', number: 1 }] });
    const saved = store.find(p.id);
    expect(saved?.setup.material).toEqual({ id: 'builtin.al-6061', version: 1, name: 'Aluminium 6061-T6' });
    expect(isProject(saved)).toBe(true);
  });

  it('changes made at the same time are all kept (each runs on the record as it is then)', async () => {
    const { store, records } = harness();
    const p = await store.create('Race');
    await store.add(p.id, [new File(['G0'], 'a.nc')]);
    const fileId = store.find(p.id)?.files[0]?.id ?? '';
    await Promise.all([store.updateFile(p.id, fileId, { note: 'first' }), store.addLink(p.id, 'Doc', 'https://example.com/d'), store.describe(p.id, 'Text'), store.rename(p.id, 'Race 2')]);
    const saved = (await records.get('projects', p.id)) as { name: string; description: string; links: unknown[]; files: { note: string }[] };
    expect(saved.name).toBe('Race 2');
    expect(saved.description).toBe('Text');
    expect(saved.links).toHaveLength(1);
    expect(saved.files[0]?.note).toBe('first');
  });

  it('skips stored records that do not read as projects', async () => {
    const { store, records } = harness();
    await records.put('projects', 'junk', { v: 1, id: 'junk' });
    await records.put('projects', 'other', 'nope');
    await store.load();
    expect(store.list).toEqual([]);
  });
});

describe('the description renders plain text with simple formatting, safely', () => {
  it('splits paragraphs and lists', () => {
    expect(blocks('First line\nsecond\n\n- a\n- b\n\n1. one\n2. two')).toEqual([
      { kind: 'p', text: 'First line\nsecond' },
      { kind: 'ul', items: ['a', 'b'] },
      { kind: 'ol', items: ['one', 'two'] },
    ]);
  });

  it('renders links only through safeExternalLink, never markup', () => {
    const html = renderToString(h(Description, { text: 'See [the drawing](https://example.com/d) and https://example.org/x.\n\n**Bold** <script>alert(1)</script> [bad](javascript:alert(1))' }));
    expect(html).toContain('<a href="https://example.com/d" rel="noopener noreferrer nofollow" target="_blank">the drawing</a>');
    expect(html).toContain('<a href="https://example.org/x" rel="noopener noreferrer nofollow" target="_blank">https://example.org/x</a>.');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('&lt;script>alert(1)&lt;/script>');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('[bad](javascript:alert(1))');
  });
});
