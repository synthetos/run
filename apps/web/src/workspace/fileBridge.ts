/**
 * The one job opener (FLOW_ANALYSIS §4 step 2): every way a G-code file
 * reaches the preview goes through `openJob`, which decides the job identity
 * (a project file version by SHA-256, or the local draft), makes that job the
 * active one and hands the file to the Run view's preview.
 *
 * The active-execution lock is enforced here, once: while the worker's job
 * owns the machine (running, paused, at a stop point, ...) nothing replaces
 * the preview under the progress marker, whether the request came from the
 * picker, a sample, Projects or a reopened job. The Run view keeps the lock
 * current from the worker's snapshot (`executionLock`).
 *
 * The Run view publishes what it has open (`currentFile` for a report's
 * excerpt, `currentPreview` for the Setup view's scene). Plain data between
 * views; nothing here reaches a machine.
 */
import { signal } from '@preact/signals';
import type { PreviewResult } from '../gcode-worker/pipeline.ts';
import type { Box3, SegmentList } from '@synthetos/gcode-view';
import { projectStore } from '../projects/browserStore.ts';
import { sha256Hex } from '../projects/image.ts';
import type { ProjectStore } from '../projects/store.ts';
import { activeJobStore, BROWSER_CLOCK, cloneJob, DRAFT_NAME, draftJobStore, newDraftJob, reviseJob, setActiveJob, withMachine, type Job, type JobClock, type JobFile } from './jobModel.ts';
import { selectedMachine, type MachineProfile } from './library.ts';
import { afterLoad } from './storage.ts';

export interface OpenFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly preview?: PreviewResult;
}

/** The file the Run view has open and checked, or null. */
export const currentFile = signal<OpenFile | null>(null);

/** The drawn path of the open file (for the Setup view's scene), or null. */
export interface CurrentPreview {
  readonly name: string;
  readonly segments: SegmentList | null;
  readonly bounds: Box3 | null;
}
export const currentPreview = signal<CurrentPreview | null>(null);

/** Why no job may be opened now (an execution owns the preview), or null. The Run view sets it from the worker's snapshot. */
export const executionLock = signal<string | null>(null);

/** Where an open request came from. */
export type OpenSource =
  | { readonly kind: 'picker' }
  | { readonly kind: 'sample' }
  | { readonly kind: 'project'; readonly projectId: string; readonly fileId: string }
  | { readonly kind: 'job'; readonly projectId: string; readonly jobId: string }
  | { readonly kind: 'reopen' };

export interface PendingOpen {
  readonly file: File;
  readonly job: Job;
}

/** A file the opener resolved; the Run view takes it and clears it. */
export const pendingOpen = signal<PendingOpen | null>(null);

export type OpenResult = { readonly ok: true; readonly job: Job } | { readonly ok: false; readonly reason: string };

/** The draft file is kept beside the projects under this key, so a reload can reopen it. */
export const DRAFT_FILE_KEY = 'draft-file';

export interface OpenDeps {
  readonly projects: () => Promise<ProjectStore>;
  readonly hash: (bytes: ArrayBuffer) => Promise<string>;
  readonly machine: () => MachineProfile | null;
  readonly clock: JobClock;
}

const BROWSER_DEPS: OpenDeps = { projects: projectStore, hash: sha256Hex, machine: () => selectedMachine.value, clock: BROWSER_CLOCK };

let openRequest = 0;

function openRefusal(request: number): Extract<OpenResult, { ok: false }> | null {
  if (executionLock.value !== null) return { ok: false, reason: `${executionLock.value} Stop the current job before opening another file.` };
  return request === openRequest ? null : { ok: false, reason: 'The file request was cancelled.' };
}

/** Leaves an empty bench with the current setup; saved project jobs are untouched. */
export function closeJob(deps: OpenDeps = BROWSER_DEPS): OpenResult {
  if (executionLock.value !== null) return { ok: false, reason: `${executionLock.value} Stop the current job before closing it.` };
  const request = ++openRequest;
  const job = { ...cloneJob(activeJobStore.value.value ?? newDraftJob(deps.clock), deps.clock), name: DRAFT_NAME };
  pendingOpen.value = null;
  currentFile.value = null;
  currentPreview.value = null;
  setActiveJob(job);
  // Do not erase a newer draft if opening storage finishes after another open request.
  void deps.projects().then((projects) => request === openRequest ? projects.forgetAside(DRAFT_FILE_KEY) : undefined).catch(() => undefined);
  return { ok: true, job };
}

/**
 * Resolves the job for `file` and makes it active:
 * - bytes that are a project file (by SHA-256, whichever entry they came through) belong to that project: the
 *   project's job for that file version, or a new job that takes the active job's setup (the bench carries
 *   over: a fixture chosen before the file was opened is not lost) on its machine or the selected one;
 * - any other bytes go to the local draft, which keeps its setup from file to file (the draft is one bench).
 */
export async function openJob(file: File, source: OpenSource, deps: OpenDeps = BROWSER_DEPS): Promise<OpenResult> {
  return resolveJob(file, source, deps, ++openRequest);
}

async function resolveJob(file: File, source: OpenSource, deps: OpenDeps, request: number): Promise<OpenResult> {
  const refused = openRefusal(request);
  if (refused !== null) return refused;
  const bytes = await file.arrayBuffer();
  const hash = await deps.hash(bytes);
  const projects = await deps.projects();
  const stale = openRefusal(request);
  if (stale !== null) return stale;
  const found =
    source.kind === 'project'
      ? projectFile(projects, source.projectId, source.fileId)
      : source.kind === 'job'
        ? projectFile(projects, source.projectId, projects.find(source.projectId)?.jobs.find((j) => j.id === source.jobId)?.file?.fileId ?? '')
        : projects.findFile(hash);
  if ((source.kind === 'project' || source.kind === 'job') && found === null) return { ok: false, reason: 'That file is no longer in the project.' };
  if (found !== null && found.file.hash !== hash) return { ok: false, reason: 'The file’s bytes are not the stored version.' };
  const ref: JobFile = { projectId: found?.project.id ?? null, fileId: found?.file.id ?? null, name: file.name, hash, size: bytes.byteLength };
  let job: Job;
  if (found !== null) {
    const existing = source.kind === 'job' ? found.project.jobs.find((j) => j.id === source.jobId) : found.project.jobs.find((j) => j.file?.fileId === found.file.id && j.file.hash === hash);
    if (existing !== undefined) job = existing;
    else {
      const base = cloneJob(activeJobStore.value.value ?? newDraftJob(deps.clock), deps.clock);
      const fresh = base.machine === null ? withMachine(base, deps.machine(), deps.clock) : base;
      job = { ...fresh, projectId: found.project.id, name: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Job', file: ref, revision: 1 };
      try {
        await projects.saveJob(job);
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : 'The job could not be saved to the project.' };
      }
    }
  } else {
    const draft = draftJobStore.value.value ?? newDraftJob(deps.clock);
    job = draft.file?.hash === hash && draft.file.name === file.name ? draft : reviseJob(draft, { file: ref }, deps.clock);
    void projects.keepAside(DRAFT_FILE_KEY, file);
  }
  const late = openRefusal(request);
  if (late !== null) return late;
  setActiveJob(job);
  pendingOpen.value = { file, job };
  return { ok: true, job };
}

/** Opens stored G-code directly, reusing its saved job when one already exists. */
export async function openProjectFile(projectId: string, fileId: string, deps: OpenDeps = BROWSER_DEPS): Promise<OpenResult> {
  const request = ++openRequest;
  const refused = openRefusal(request);
  if (refused !== null) return refused;
  const projects = await deps.projects();
  const found = projectFile(projects, projectId, fileId);
  const blob = found === null ? null : await projects.blob(fileId);
  if (found === null || blob === null) return { ok: false, reason: 'The file is no longer stored in this browser.' };
  return resolveJob(new File([blob], found.file.name, { type: 'text/plain' }), { kind: 'project', projectId, fileId }, deps, request);
}

function projectFile(projects: ProjectStore, projectId: string, fileId: string): ReturnType<ProjectStore['findFile']> {
  const project = projects.find(projectId);
  const file = project?.files.find((f) => f.id === fileId);
  return project === null || project === undefined || file === undefined ? null : { project, file };
}

/** Opens a project's job: its file version from the project's storage. */
export async function openProjectJob(projectId: string, jobId: string, deps: OpenDeps = BROWSER_DEPS): Promise<OpenResult> {
  const request = ++openRequest;
  const refused = openRefusal(request);
  if (refused !== null) return refused;
  const projects = await deps.projects();
  const project = projects.find(projectId);
  const job = project?.jobs.find((j) => j.id === jobId);
  if (project === null || project === undefined || job === undefined) return { ok: false, reason: 'That job no longer exists.' };
  if (job.file === null || job.file.fileId === null) return { ok: false, reason: 'This job has no G-code file yet.' };
  const stored = project.files.find((f) => f.id === job.file?.fileId);
  const blob = stored === undefined ? null : await projects.blob(stored.id);
  if (stored === undefined || blob === null) return { ok: false, reason: 'The job’s file is no longer stored in this browser.' };
  return resolveJob(new File([blob], stored.name, { type: 'text/plain' }), { kind: 'job', projectId, jobId }, deps, request);
}

let reopened = false;

/** Whether the page will reopen a file: the active job has one. */
function hasFileToReopen(): boolean {
  return activeJobStore.value.value?.file != null;
}

/**
 * True from the moment the stored job loads while its file is still to be reopened (until `reopenActiveJob` has
 * handed it to the preview or found nothing to open), so the Run view does not offer the samples for a moment and
 * then swap them for the job. The stores load after hydration (storage.ts), so it is set then, not here.
 */
export const reopening = signal<boolean>(false);
afterLoad(() => {
  reopening.value = !reopened && hasFileToReopen();
});

/**
 * Once per page: reopens the active job's file after a reload (a project file version, or the draft's file
 * kept aside), so the job comes back intact. Nothing is reopened while an execution owns the preview.
 */
export async function reopenActiveJob(deps: OpenDeps = BROWSER_DEPS): Promise<OpenResult | null> {
  if (reopened) return null;
  reopened = true;
  try {
    const job = activeJobStore.value.value;
    if (job === null || job.file === null || executionLock.value !== null) return null;
    if (job.projectId !== null) return await openProjectJob(job.projectId, job.id, deps);
    const request = ++openRequest;
    const projects = await deps.projects();
    const blob = await projects.aside(DRAFT_FILE_KEY);
    if (blob === null) return null;
    return await resolveJob(new File([blob], job.file.name, { type: 'text/plain' }), { kind: 'reopen' }, deps, request);
  } finally {
    reopening.value = false;
  }
}

/** Tests only: forget that the page reopened its job. */
export function resetReopen(): void {
  reopened = false;
  reopening.value = hasFileToReopen();
}

/**
 * Saves the draft job to a project: its file becomes a project file (checked against the project's limits),
 * the job moves in with its setup, and a fresh draft takes its place.
 */
export async function saveDraftToProject(projectId: string, deps: OpenDeps = BROWSER_DEPS): Promise<OpenResult> {
  const job = activeJobStore.value.value;
  const open = currentFile.value;
  if (job === null || job.projectId !== null) return { ok: false, reason: 'Only the draft can be saved to a project.' };
  if (job.file === null || open === null || open.name !== job.file.name) return { ok: false, reason: 'Open a G-code file first.' };
  const projects = await deps.projects();
  const project = projects.find(projectId);
  if (project === null) return { ok: false, reason: 'That project no longer exists.' };
  let fileId = project.files.find((f) => f.hash === job.file?.hash)?.id ?? null;
  if (fileId === null) {
    const r = await projects.add(projectId, [new File([open.bytes.slice()], job.file.name, { type: 'text/plain' })]);
    const refused = r.refused[0];
    if (refused !== undefined) return { ok: false, reason: refused };
    fileId = projects.find(projectId)?.files.find((f) => f.hash === job.file?.hash)?.id ?? null;
    if (fileId === null) return { ok: false, reason: 'The file was not stored.' };
  }
  const saved = reviseJob(job, { projectId, name: job.name === 'Draft setup' || job.name.startsWith('Draft setup') ? job.file.name.replace(/\.[^.]+$/, '') : job.name, file: { ...job.file, projectId, fileId } }, deps.clock);
  try {
    await projects.saveJob(saved);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'The job could not be saved.' };
  }
  draftJobStore.set(newDraftJob(deps.clock));
  setActiveJob(saved);
  return { ok: true, job: saved };
}
