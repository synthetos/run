/**
 * The one project store of this page (projects/store.ts on this browser's
 * IndexedDB), opened on first use by whichever view or opener needs it. It
 * also registers the job persistence hook (workspace/jobModel.ts): a project
 * job changed in Run or Setup is written back into its project.
 */
import { signal } from '@preact/signals';
import { jobPersistence } from '../workspace/jobModel.ts';
import { browserRecordStore, type RecordStore } from '../workspace/storage.ts';
import { encodeImage, sha256Hex } from './image.ts';
import { projectsState, ProjectStore } from './store.ts';

export const projectScope = signal(0);
export function refreshProjectImages(): void { projectScope.value++; }
let store: ProjectStore | null = null;
let accountStore: ProjectStore | null = null;
let localRecords: RecordStore | null = null;
let starting: Promise<ProjectStore> | null = null;

/** Publishes the store's list to the views' signal. */
export function publishProjects(s: ProjectStore): void {
  if (!isActiveProjectStore(s)) return;
  projectsState.value = { loaded: true, persistent: s.persistent, list: s.list };
}
export const isActiveProjectStore = (s: ProjectStore): boolean => s === (accountStore ?? store);

export function projectStore(): Promise<ProjectStore> {
  if (accountStore !== null) return Promise.resolve(accountStore);
  if (store !== null) return Promise.resolve(store);
  starting ??= (async () => {
    const records = await browserRecordStore();
    localRecords = records;
    const s = makeProjectStore(records);
    await s.load().catch(() => undefined);
    store = s;
    jobPersistence.value = (job) =>
      projectStore().then(current => current.saveJob(job).then(() => publishProjects(current))).then(
        () => true,
        () => false,
      );
    publishProjects(s);
    return s;
  })();
  return starting;
}

/** Runs one change on the store and republishes the list, whatever the outcome. */
export async function withProjects<T>(fn: (s: ProjectStore) => Promise<T>): Promise<T> {
  const s = await projectStore();
  try {
    return await fn(s);
  } finally {
    publishProjects(s);
  }
}

export function makeProjectStore(records: RecordStore): ProjectStore {
  return new ProjectStore({ records, now: () => new Date(), newId: () => crypto.randomUUID(), hash: sha256Hex, encodeImage: f => encodeImage(f) });
}
export async function localProjectContext(): Promise<{ records: RecordStore; local: ProjectStore }> {
  await projectStore();
  return { records: localRecords!, local: store! };
}
export function activateProjectStore(next: ProjectStore | null): void {
  if (accountStore !== next) refreshProjectImages();
  accountStore = next;
  if (next !== null) publishProjects(next);
  else if (store !== null) void store.load().then(() => publishProjects(store!));
}
