/**
 * The one project store of this page (projects/store.ts on this browser's
 * IndexedDB), opened on first use by whichever view or opener needs it. It
 * also registers the job persistence hook (workspace/jobModel.ts): a project
 * job changed in Run or Setup is written back into its project.
 */
import { jobPersistence } from '../workspace/jobModel.ts';
import { browserRecordStore } from '../workspace/storage.ts';
import { encodeImage, sha256Hex } from './image.ts';
import { projectsState, ProjectStore } from './store.ts';

let store: ProjectStore | null = null;
let starting: Promise<ProjectStore> | null = null;

/** Publishes the store's list to the views' signal. */
export function publishProjects(s: ProjectStore): void {
  projectsState.value = { loaded: true, persistent: s.persistent, list: s.list };
}

export function projectStore(): Promise<ProjectStore> {
  if (store !== null) return Promise.resolve(store);
  starting ??= (async () => {
    const records = await browserRecordStore();
    const s = new ProjectStore({ records, now: () => new Date(), newId: () => crypto.randomUUID(), hash: sha256Hex, encodeImage: (f) => encodeImage(f) });
    await s.load().catch(() => undefined);
    store = s;
    jobPersistence.value = (job) =>
      s.saveJob(job).then(
        () => {
          publishProjects(s);
          return true;
        },
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
