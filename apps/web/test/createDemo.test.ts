import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeProjectStore } from '../src/projects/browserStore.ts';
import type { ProjectStore } from '../src/projects/store.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { toolStore } from '../src/workspace/library.ts';
import { memoryRecordStore } from '../src/workspace/storage.ts';
import { createDemo, createNamed, openExisting } from '../src/wizard/createDemo.ts';
import { DEMO_NAME, DEMO_TOOL } from '../src/wizard/demoProject.ts';

function deps(lock: string | null = null) {
  const store = makeProjectStore(memoryRecordStore());
  const open = vi.fn(async () => ({ ok: true as const, job: {} as never }));
  return { store, open, deps: { projects: <T>(fn: (s: ProjectStore) => Promise<T>) => fn(store), open, lock: () => lock } };
}
afterEach(() => { toolStore.set(SEED_TOOLS); });

describe('createDemo (spec §6.3 step 6, §6.4)', () => {
  it('creates the project with the file and the setup, adds the demo tool once, and opens the file', async () => {
    const d = deps();
    const result = await createDemo(d.deps);
    expect(result).toMatchObject({ ok: true, name: DEMO_NAME, reason: null });
    const p = d.store.find(result.projectId as string);
    expect(p?.files.map((f) => [f.name, f.role])).toEqual([['name-plate.nc', 'gcode']]);
    expect(p?.setup.tools[0]?.id).toBe(DEMO_TOOL.id);
    expect(p?.setup.stockSnapshot?.width).toBe(180);
    expect(toolStore.value.value.filter((e) => e.tool.id === DEMO_TOOL.id)).toHaveLength(1);
    expect(d.open).toHaveBeenCalledWith(result.projectId, p?.files[0]?.id);
    await createDemo(d.deps);
    expect(toolStore.value.value.filter((e) => e.tool.id === DEMO_TOOL.id)).toHaveLength(1);
  });
  it('uses the stock from setup when there is one', async () => {
    const d = deps();
    const result = await createDemo(d.deps, { width: 200, depth: 150, thickness: 12, shape: 'block', materialRef: { id: 'builtin.mdf', version: 1 }, position: { x: 0, y: 0 }, zero: { corner: 'front-left', height: 'top' } });
    expect(d.store.find(result.projectId as string)?.setup.stockSnapshot).toMatchObject({ width: 200, depth: 150, thickness: 12 });
  });
  it('with a job running the project is created but the file is not opened, and the lock is the reason (Review Focus 5)', async () => {
    const d = deps('A job is running.');
    const result = await createDemo(d.deps);
    expect(result).toMatchObject({ ok: false, reason: 'A job is running.' });
    expect(result.projectId).not.toBeNull();
    expect(d.open).not.toHaveBeenCalled();
  });
  it('reports the opener’s refusal', async () => {
    const d = deps();
    d.open.mockResolvedValueOnce({ ok: false, reason: 'No file.' } as never);
    expect(await createDemo(d.deps)).toMatchObject({ ok: false, reason: 'No file.' });
  });
});

describe('openExisting (a retry after a refused open never makes a second project)', () => {
  it('opens the project the record names; an unknown id or a lock is a reason, not a new project', async () => {
    const d = deps();
    const made = await createDemo(d.deps);
    d.open.mockClear();
    const again = await openExisting(made.projectId as string, d.deps);
    expect(again).toMatchObject({ ok: true, projectId: made.projectId, name: DEMO_NAME, reason: null });
    expect(d.open).toHaveBeenCalledWith(made.projectId, d.store.find(made.projectId as string)?.files[0]?.id);
    expect(d.store.list).toHaveLength(1);
    expect(await openExisting('no-such', d.deps)).toMatchObject({ ok: false, projectId: null, reason: 'That project no longer exists.' });
    const locked = deps('A job is running.');
    const first = await createDemo(locked.deps);
    expect(await openExisting(first.projectId as string, locked.deps)).toMatchObject({ ok: false, projectId: first.projectId, reason: 'A job is running.' });
  });
});

describe('createNamed (R10)', () => {
  it('creates an empty project by name; a blank name falls back to the store’s default', async () => {
    const d = deps();
    const named = await createNamed('Bracket', d.deps);
    expect(named).toMatchObject({ ok: true, name: 'Bracket', reason: null });
    expect(d.store.find(named.projectId as string)?.files).toEqual([]);
    expect((await createNamed('   ', d.deps)).name).toBe('Untitled project');
    expect(d.open).not.toHaveBeenCalled();
  });
});
