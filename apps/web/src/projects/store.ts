/**
 * Projects, Stage 1 (local): docs/design/PROJECTS.md §1-§3. A project keeps
 * its description, cover and images, files with roles and notes, links, and
 * references to the machine, stock, material and tools used.
 *
 * Everything is stored in this browser's IndexedDB through the workspace
 * storage module (workspace/storage.ts `RecordStore`): project records in
 * `projects`, file and image bytes in `blobs`, keyed by their own ids. A
 * project record holds only references, so listing projects never loads a
 * file. Account sync (Stage 2) replaces the backend later.
 *
 * Every limit is checked before anything is stored (limits.ts). Images are
 * re-encoded to WebP, at most 2000 px, through a canvas, which also drops
 * their EXIF metadata (location included); the original is never stored.
 */
import {
  PROJECT_FORMAT,
  isJob,
  isProjectShape,
  type Job,
  type Project,
  type ProjectFile,
  type ProjectImage,
  type ProjectLink,
  type ProjectSetup,
  type RecordRef,
} from '@synthetos/library';
import { signal } from '@preact/signals';
import { safeExternalLink } from '../workspace/library.ts';
import { putProjectBlob, readStoredBlob, type ProjectRecordStore } from './blobStore.ts';
import { ProjectDraftStore } from './draftStore.ts';
import { installProjectZip } from './importStore.ts';
import type { ImportOptions } from './zip/import.ts';
import { removeUnusedBlob } from './unusedBlobs.ts';
import { checkEncoded, checkFile, checkImage, classify, type FileRole } from './limits.ts';

// The record types and the readers are the package's (`@synthetos/library` project.ts), shared with the account store.
export { PROJECT_FORMAT };
export type { Project, ProjectFile, ProjectImage, ProjectLink, ProjectSetup, RecordRef };

export const EMPTY_SETUP: ProjectSetup = Object.freeze({ machine: null, stock: null, material: null, tools: Object.freeze([]) });

/** Bytes a project stores: its files plus its re-encoded images. */
export function projectUsage(p: Pick<Project, 'files' | 'images'>): number {
  return p.files.reduce((n, f) => n + f.size, 0) + p.images.reduce((n, i) => n + i.size, 0);
}

/** A stored record that still reads as a project (anything else is skipped, never trusted). Its jobs are read one by one by `readProject`. */
export function isProject(v: unknown): v is Project {
  return isProjectShape(v);
}

/** A stored record as a project, with its jobs read one by one (an unreadable job is dropped, the rest kept). */
export function readProject(v: unknown): Project | null {
  if (!isProjectShape(v)) return null;
  return { ...v, jobs: (v.jobs ?? []).filter(isJob) };
}

export interface EncodedImage {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

export interface ProjectDeps {
  readonly records: ProjectRecordStore;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly hash: (bytes: ArrayBuffer) => Promise<string>;
  /** Re-encodes an image to WebP within 2000 px (projects/image.ts in the browser). */
  readonly encodeImage: (file: Blob) => Promise<EncodedImage>;
}

export type AddResult = { readonly added: readonly string[]; readonly refused: readonly string[] };

export class ProjectStore extends ProjectDraftStore {
  readonly #deps: ProjectDeps;
  #projects: Project[] = [];
  /** Every change runs after the one before, each from the stored record as it is then: no lost updates. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(deps: ProjectDeps) {
    super(deps.records);
    this.#deps = deps;
  }

  get persistent(): boolean {
    return this.#deps.records.persistent;
  }

  /** Every project, most recently changed first. */
  get list(): readonly Project[] {
    return [...this.#projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  find(id: string): Project | null {
    return this.#projects.find((p) => p.id === id) ?? null;
  }

  load(): Promise<void> {
    return this.#serial(async () => {
      const keys = await this.#deps.records.keys('projects');
      const found: Project[] = [];
      for (const k of keys) {
        if (k.includes('/')) continue; // Account drafts and download markers never enter the local library.
        const p = readProject(await this.#deps.records.get('projects', k));
        if (p !== null) found.push(p);
      }
      this.#projects = found;
    });
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #save(p: Project): Promise<Project> {
    const next = { ...p, updatedAt: this.#deps.now().toISOString() };
    await this.#deps.records.put('projects', next.id, next);
    this.#projects = [...this.#projects.filter((x) => x.id !== next.id), next];
    return next;
  }

  #need(id: string): Project {
    const p = this.find(id);
    if (p === null) throw new Error('That project no longer exists.');
    return p;
  }

  create(name: string): Promise<Project> {
    return this.#serial(async () => {
      const at = this.#deps.now().toISOString();
      const p: Project = { v: PROJECT_FORMAT, id: this.#deps.newId(), name: cleanName(name) || 'Untitled project', description: '', cover: null, images: [], files: [], links: [], setup: EMPTY_SETUP, jobs: [], tags: [], createdAt: at, updatedAt: at };
      return this.#save(p);
    });
  }

  rename(id: string, name: string): Promise<Project> {
    return this.#serial(async () => {
      const clean = cleanName(name);
      if (clean === '') throw new Error('A project needs a name.');
      return this.#save({ ...this.#need(id), name: clean });
    });
  }

  describe(id: string, description: string): Promise<Project> {
    return this.#serial(async () => {
      return this.#save({ ...this.#need(id), description: description.slice(0, 20_000) });
    });
  }

  setSetup(id: string, setup: ProjectSetup): Promise<Project> {
    return this.#serial(async () => {
      return this.#save({ ...this.#need(id), setup });
    });
  }

  /** Deletes the project and every file and image it holds. */
  remove(id: string): Promise<void> {
    return this.#serial(async () => {
      const p = this.#need(id);
      const remaining = this.#projects.filter(project => project.id !== id);
      for (const file of [...p.files, ...p.images]) await removeUnusedBlob(this.#deps.records, file, remaining);
      await this.#deps.records.delete('projects', id);
      this.#projects = this.#projects.filter((x) => x.id !== id);
    });
  }

  /** Adds files and images, each checked against the limits first. Images are re-encoded. */
  add(id: string, files: readonly File[]): Promise<AddResult> {
    return this.#serial(async () => {
      const added: string[] = [];
      const refused: string[] = [];
      for (const file of files) {
        const p = this.#need(id);
        const used = projectUsage(p);
        const kind = classify(file.name, file.type);
        if (kind === 'image') {
          const before = checkImage(file.name, file.size);
          if (!before.ok) {
            refused.push(before.reason);
            continue;
          }
          let encoded: EncodedImage;
          try {
            encoded = await this.#deps.encodeImage(file);
          } catch {
            refused.push(`${file.name} could not be read as an image.`);
            continue;
          }
          const after = checkEncoded(file.name, encoded.blob.size, used);
          if (!after.ok) {
            refused.push(after.reason);
            continue;
          }
          const imageId = this.#deps.newId();
          await putProjectBlob(this.#deps.records, id, imageId, encoded.blob);
          const image: ProjectImage = { id: imageId, hash: await this.#deps.hash(await encoded.blob.arrayBuffer()), name: file.name.replace(/\.[^.]+$/, '') + '.webp', size: encoded.blob.size, width: encoded.width, height: encoded.height, addedAt: this.#deps.now().toISOString() };
          await this.#save({ ...p, images: [...p.images, image], cover: p.cover ?? imageId });
          added.push(image.name);
          continue;
        }
        const check = checkFile(file.name, file.size, kind, used);
        if (!check.ok) {
          refused.push(check.reason);
          continue;
        }
        const bytes = await file.arrayBuffer();
        const fileId = this.#deps.newId();
        await putProjectBlob(this.#deps.records, id, fileId, new Blob([bytes], { type: file.type || 'application/octet-stream' }));
        const entry: ProjectFile = { id: fileId, name: file.name, size: file.size, hash: await this.#deps.hash(bytes), role: kind, note: '', addedAt: this.#deps.now().toISOString() };
        await this.#save({ ...p, files: [...p.files, entry] });
        added.push(file.name);
      }
      return { added, refused };
    });
  }

  updateFile(id: string, fileId: string, patch: { readonly role?: FileRole; readonly note?: string }): Promise<Project> {
    return this.#serial(async () => {
      const p = this.#need(id);
      const file = p.files.find((f) => f.id === fileId);
      if (file === undefined) throw new Error('That file is no longer in the project.');
      const role = patch.role ?? file.role;
      if (role !== file.role) {
        const check = checkFile(file.name, file.size, role, projectUsage(p) - file.size);
        if (!check.ok) throw new Error(check.reason);
      }
      return this.#save({ ...p, files: p.files.map((f) => (f.id === fileId ? { ...f, role, note: (patch.note ?? f.note).slice(0, 500) } : f)) });
    });
  }

  removeFile(id: string, fileId: string): Promise<Project> {
    return this.#serial(async () => {
      const p = this.#need(id);
      const next = { ...p, files: p.files.filter((f) => f.id !== fileId) };
      const file = p.files.find(file => file.id === fileId);
      if (file) await removeUnusedBlob(this.#deps.records, file, this.#projects.map(project => project.id === id ? next : project));
      return this.#save(next);
    });
  }

  removeImage(id: string, imageId: string): Promise<Project> {
    return this.#serial(async () => {
      const p = this.#need(id);
      const images = p.images.filter((i) => i.id !== imageId);
      const next = { ...p, images, cover: p.cover === imageId ? (images[0]?.id ?? null) : p.cover };
      const image = p.images.find(image => image.id === imageId);
      if (image) await removeUnusedBlob(this.#deps.records, image, this.#projects.map(project => project.id === id ? next : project));
      return this.#save(next);
    });
  }

  setCover(id: string, imageId: string): Promise<Project> {
    return this.#serial(async () => {
      const p = this.#need(id);
      if (!p.images.some((i) => i.id === imageId)) throw new Error('That image is no longer in the project.');
      return this.#save({ ...p, cover: imageId });
    });
  }

  addLink(id: string, title: string, url: string): Promise<Project> {
    return this.#serial(async () => {
      const p = this.#need(id);
      const safe = safeExternalLink(url.trim());
      if (safe === null) throw new Error('Links must be web addresses (https or http).');
      const link: ProjectLink = { id: this.#deps.newId(), title: cleanName(title).slice(0, 120) || safe.href, url: safe.href };
      return this.#save({ ...p, links: [...p.links, link] });
    });
  }

  removeLink(id: string, linkId: string): Promise<Project> {
    return this.#serial(async () => {
      const p = this.#need(id);
      return this.#save({ ...p, links: p.links.filter((l) => l.id !== linkId) });
    });
  }

  /**
   * Writes a job into its project (added, or replaced by id). The project record is the authority for its
   * jobs; a write the store refuses leaves the record as it was.
   */
  saveJob(job: Job): Promise<Project> {
    return this.#serial(async () => {
      if (job.projectId === null) throw new Error('A draft job has no project.');
      const p = this.#need(job.projectId);
      const jobs = p.jobs.some((j) => j.id === job.id) ? p.jobs.map((j) => (j.id === job.id ? job : j)) : [...p.jobs, job];
      return this.#save({ ...p, jobs });
    });
  }

  removeJob(id: string, jobId: string): Promise<Project> {
    return this.#serial(async () => {
      const p = this.#need(id);
      return this.#save({ ...p, jobs: p.jobs.filter((j) => j.id !== jobId) });
    });
  }

  /** The project file with these bytes (by SHA-256), in any project; null when none has it. */
  findFile(hash: string): { readonly project: Project; readonly file: ProjectFile } | null {
    for (const project of this.list) {
      const file = project.files.find((f) => f.hash === hash);
      if (file !== undefined) return { project, file };
    }
    return null;
  }

  /** A stored file's or image's bytes, or null. */
  async blob(blobId: string): Promise<Blob | null> {
    return readStoredBlob(this.#deps.records, blobId);
  }

  /** Archives validate the actual stored record, including jobs the lenient browser view cannot read. */
  exportRecord(id: string): Promise<unknown> { return this.#deps.records.get('projects', id); }

  importZip(zip: Blob, options: ImportOptions = {}): Promise<Project> {
    return this.#serial(async () => {
      const project = await installProjectZip(zip, { records: this.#deps.records, projects: this.#projects, newId: this.#deps.newId }, options);
      this.#projects = [...this.#projects, project];
      return project;
    });
  }

}

/** A project or link name: one line, trimmed, at most 120 characters. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** The view's state: the projects as last loaded, and whether storage persists. */
export const projectsState = signal<{ readonly loaded: boolean; readonly persistent: boolean; readonly list: readonly Project[] }>({ loaded: false, persistent: true, list: [] });
