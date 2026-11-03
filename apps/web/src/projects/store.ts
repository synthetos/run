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
import { signal } from '@preact/signals';
import { isJob, type Job } from '../workspace/jobModel.ts';
import { safeExternalLink } from '../workspace/library.ts';
import { isArray, isObject, type RecordStore } from '../workspace/storage.ts';
import { checkEncoded, checkFile, checkImage, classify, type FileRole } from './limits.ts';

export const PROJECT_FORMAT = 1;

export interface ProjectFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  /** SHA-256 of the bytes, hex. */
  readonly hash: string;
  readonly role: FileRole;
  readonly note: string;
  readonly addedAt: string;
}

export interface ProjectImage {
  readonly id: string;
  readonly name: string;
  /** Bytes of the re-encoded WebP. */
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly addedAt: string;
}

export interface ProjectLink {
  readonly id: string;
  readonly title: string;
  readonly url: string;
}

/** A library record by id and version, with the name it had when chosen. */
export interface RecordRef {
  readonly id: string;
  readonly version?: number;
  readonly name: string;
}

export interface ProjectSetup {
  readonly machine: RecordRef | null;
  /** The stock as a short description of the setup's stock when chosen ("Block 180 × 120 × 6.35 mm"). */
  readonly stock: RecordRef | null;
  readonly material: RecordRef | null;
  readonly tools: readonly (RecordRef & { readonly number?: number })[];
}

export interface Project {
  readonly v: typeof PROJECT_FORMAT;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** The id of one of `images`, or null. */
  readonly cover: string | null;
  readonly images: readonly ProjectImage[];
  readonly files: readonly ProjectFile[];
  readonly links: readonly ProjectLink[];
  readonly setup: ProjectSetup;
  /** The project's jobs (workspace/jobModel.ts): each links one of `files` to a machine revision and a setup. */
  readonly jobs: readonly Job[];
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const EMPTY_SETUP: ProjectSetup = Object.freeze({ machine: null, stock: null, material: null, tools: Object.freeze([]) });

/** Bytes a project stores: its files plus its re-encoded images. */
export function projectUsage(p: Pick<Project, 'files' | 'images'>): number {
  return p.files.reduce((n, f) => n + f.size, 0) + p.images.reduce((n, i) => n + i.size, 0);
}

const isRef = (v: unknown): boolean => v === null || (isObject(v) && typeof v['id'] === 'string' && typeof v['name'] === 'string');

/** A stored record that still reads as a project (anything else is skipped, never trusted). */
export function isProject(v: unknown): v is Project {
  if (!isObject(v) || v['v'] !== PROJECT_FORMAT || typeof v['id'] !== 'string' || typeof v['name'] !== 'string' || typeof v['description'] !== 'string') return false;
  if (!isArray(v['images']) || !isArray(v['files']) || !isArray(v['links']) || !isArray(v['tags'])) return false;
  if (!v['files'].every((f) => isObject(f) && typeof f['id'] === 'string' && typeof f['name'] === 'string' && typeof f['size'] === 'number' && typeof f['role'] === 'string')) return false;
  if (!v['images'].every((i) => isObject(i) && typeof i['id'] === 'string' && typeof i['size'] === 'number')) return false;
  if (!v['links'].every((l) => isObject(l) && typeof l['url'] === 'string' && typeof l['title'] === 'string')) return false;
  const s = v['setup'];
  if (!(isObject(s) && isRef(s['machine']) && isRef(s['stock']) && isRef(s['material']) && isArray(s['tools']) && s['tools'].every(isRef))) return false;
  // Records from before jobs have none; a job that no longer reads is skipped by `readProject`, never trusted.
  return v['jobs'] === undefined || isArray(v['jobs']);
}

/** A stored record as a project, with its jobs read one by one (an unreadable job is dropped, the rest kept). */
export function readProject(v: unknown): Project | null {
  if (!isProject(v)) return null;
  const jobs = (v.jobs as readonly unknown[] | undefined) ?? [];
  return { ...v, jobs: jobs.filter(isJob) };
}

export interface EncodedImage {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

export interface ProjectDeps {
  readonly records: RecordStore;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly hash: (bytes: ArrayBuffer) => Promise<string>;
  /** Re-encodes an image to WebP within 2000 px (projects/image.ts in the browser). */
  readonly encodeImage: (file: Blob) => Promise<EncodedImage>;
}

export type AddResult = { readonly added: readonly string[]; readonly refused: readonly string[] };

export class ProjectStore {
  readonly #deps: ProjectDeps;
  #projects: Project[] = [];
  /** Every change runs after the one before, each from the stored record as it is then: no lost updates. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(deps: ProjectDeps) {
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

  async load(): Promise<void> {
    const keys = await this.#deps.records.keys('projects');
    const found: Project[] = [];
    for (const k of keys) {
      const p = readProject(await this.#deps.records.get('projects', k));
      if (p !== null) found.push(p);
    }
    this.#projects = found;
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
      for (const f of p.files) await this.#deps.records.delete('blobs', f.id);
      for (const i of p.images) await this.#deps.records.delete('blobs', i.id);
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
          await this.#deps.records.put('blobs', imageId, encoded.blob);
          const image: ProjectImage = { id: imageId, name: file.name.replace(/\.[^.]+$/, '') + '.webp', size: encoded.blob.size, width: encoded.width, height: encoded.height, addedAt: this.#deps.now().toISOString() };
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
        await this.#deps.records.put('blobs', fileId, new Blob([bytes], { type: file.type || 'application/octet-stream' }));
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
      await this.#deps.records.delete('blobs', fileId);
      return this.#save({ ...p, files: p.files.filter((f) => f.id !== fileId) });
    });
  }

  removeImage(id: string, imageId: string): Promise<Project> {
    return this.#serial(async () => {
      const p = this.#need(id);
      await this.#deps.records.delete('blobs', imageId);
      const images = p.images.filter((i) => i.id !== imageId);
      return this.#save({ ...p, images, cover: p.cover === imageId ? (images[0]?.id ?? null) : p.cover });
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
    const v = await this.#deps.records.get('blobs', blobId);
    return v instanceof Blob ? v : null;
  }

  /** Keeps a blob outside any project (the draft job's file), replacing the last one; false when refused. */
  async keepAside(key: string, blob: Blob): Promise<boolean> {
    try {
      await this.#deps.records.put('blobs', `aside/${key}`, blob);
      return true;
    } catch {
      return false;
    }
  }

  async aside(key: string): Promise<Blob | null> {
    return this.blob(`aside/${key}`);
  }
}

/** A project or link name: one line, trimmed, at most 120 characters. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** The view's state: the projects as last loaded, and whether storage persists. */
export const projectsState = signal<{ readonly loaded: boolean; readonly persistent: boolean; readonly list: readonly Project[] }>({ loaded: false, persistent: true, list: [] });
