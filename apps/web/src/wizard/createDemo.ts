/**
 * Step 6's writes (spec §6.3 step 6): the demo project as a real project in the account with the records it
 * references (the demo tool when missing; MDF is builtin), then the file opened on the Job page through the
 * existing opener; or an empty named project (R10). Everything goes through the existing project store and tool
 * library, which the account sync carries; nothing here touches storage of its own.
 */
import type { Stock } from '@synthetos/library';
import { withProjects } from '../projects/browserStore.ts';
import type { ProjectStore } from '../projects/store.ts';
import { executionLock, openProjectFile, type OpenResult } from '../workspace/fileBridge.ts';
import { selectedMachine, toolStore, type ToolEntry } from '../workspace/library.ts';
import { freeToolNumber } from '../workspace/tools/freeNumber.ts';
import { DEMO_NAME, DEMO_STOCK, DEMO_TOOL, demoFile, demoSetup } from './demoProject.ts';

export interface CreateDeps {
  readonly projects: <T>(fn: (s: ProjectStore) => Promise<T>) => Promise<T>;
  readonly open: (projectId: string, fileId: string) => Promise<OpenResult>;
  /** Why another job cannot be opened now (fileBridge.ts executionLock), or null. */
  readonly lock: () => string | null;
}

const LIVE: CreateDeps = { projects: withProjects, open: openProjectFile, lock: () => executionLock.value };

export interface CreateResult { readonly ok: boolean; readonly projectId: string | null; readonly name: string; readonly reason: string | null }

/** The demo tool's library entry, added once when missing. */
export function ensureDemoTool(): ToolEntry {
  const list = toolStore.value.value;
  const found = list.find((e) => e.tool.id === DEMO_TOOL.id);
  if (found !== undefined) return found;
  const entry: ToolEntry = { number: freeToolNumber(list), store: null, tool: DEMO_TOOL };
  toolStore.set([...list, entry]);
  return entry;
}

export async function createDemo(deps: CreateDeps = LIVE, stock: Stock | null = null): Promise<CreateResult> {
  const tool = ensureDemoTool();
  const machine = selectedMachine.value;
  const project = await deps.projects(async (s) => {
    const p = await s.create(DEMO_NAME);
    await s.add(p.id, [demoFile()]);
    return s.setSetup(p.id, demoSetup(machine, tool, stock ?? DEMO_STOCK));
  });
  const result = { projectId: project.id, name: project.name };
  const fileId = project.files[0]?.id;
  const lock = deps.lock();
  if (lock !== null) return { ...result, ok: false, reason: lock };
  if (fileId === undefined) return { ...result, ok: false, reason: 'The demo file was not stored.' };
  const opened = await deps.open(project.id, fileId);
  return opened.ok ? { ...result, ok: true, reason: null } : { ...result, ok: false, reason: opened.reason };
}

export async function createNamed(name: string, deps: CreateDeps = LIVE): Promise<CreateResult> {
  const project = await deps.projects((s) => s.create(name));
  return { ok: true, projectId: project.id, name: project.name, reason: null };
}
