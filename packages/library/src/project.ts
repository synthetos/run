/**
 * A project record (docs/design/PROJECTS.md §1): description, cover and
 * images, files with roles and notes, links, the setup references and the
 * project's jobs. The record holds only references; file and image bytes live
 * elsewhere (the browser's IndexedDB, or the account's files bucket by hash).
 *
 * Two readers, on purpose:
 * - `isProjectShape` is the lenient check the browser has always used on its
 *   own stored records (jobs are read one by one by the caller);
 * - `readProject` is the strict reader a record passes before it enters an
 *   account: every field, every job, unknown fields refused.
 */
import { frozenCopy } from './freeze.ts';
import { isJob, type Job } from './job.ts';
import { SHA256_HEX, isArray, isDateTime, isNum, isObject } from './shape.ts';
import type { Stock } from './types.ts';
import { URL_MAX_LENGTH } from './url.ts';
import { readStock, type LibraryResult } from './validate.ts';

export const PROJECT_FORMAT = 1;

export type FileRole = 'gcode' | 'drawing' | 'model' | 'other';
export const FILE_ROLES: readonly FileRole[] = ['gcode', 'drawing', 'model', 'other'];

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
  /** SHA-256 of the stored WebP; older browser images gain it on sync. */
  readonly hash?: string;
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
  /** The stock as a short description when chosen ("Block 180 × 120 × 6.35 mm"). */
  readonly stock: RecordRef | null;
  /** Older records keep only the label; never infer geometry from that label. */
  readonly stockSnapshot?: Stock;
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
  /** The project's jobs: each links one of `files` to a machine revision and a setup. */
  readonly jobs: readonly Job[];
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------- the lenient shape

const isRef = (v: unknown): boolean => v === null || (isObject(v) && typeof v['id'] === 'string' && typeof v['name'] === 'string');
const isFileShape = (f: unknown): boolean => isObject(f) && typeof f['id'] === 'string' && typeof f['name'] === 'string' && typeof f['size'] === 'number' && typeof f['role'] === 'string';
const isImageShape = (i: unknown): boolean => isObject(i) && typeof i['id'] === 'string' && typeof i['size'] === 'number';
const isLinkShape = (l: unknown): boolean => isObject(l) && typeof l['url'] === 'string' && typeof l['title'] === 'string';

function isSetupShape(s: unknown): boolean {
  if (!(isObject(s) && isRef(s['machine']) && isRef(s['stock']) && isRef(s['material']) && isArray(s['tools']) && s['tools'].every(isRef))) return false;
  return s['stockSnapshot'] === undefined || readStock(s['stockSnapshot']).ok;
}

/** The shape without its jobs: what a project record must have before its jobs are read one by one. */
export type ProjectShape = Omit<Project, 'jobs'> & { readonly jobs?: readonly unknown[] };

const hasProjectHead = (v: Record<string, unknown>): boolean =>
  v['v'] === PROJECT_FORMAT && typeof v['id'] === 'string' && typeof v['name'] === 'string' && typeof v['description'] === 'string'
  && (v['cover'] === null || typeof v['cover'] === 'string') && typeof v['createdAt'] === 'string' && typeof v['updatedAt'] === 'string';

function hasProjectLists(v: Record<string, unknown>): boolean {
  if (!isArray(v['images']) || !isArray(v['files']) || !isArray(v['links']) || !isArray(v['tags'])) return false;
  return v['files'].every(isFileShape) && v['images'].every(isImageShape) && v['links'].every(isLinkShape);
}

/** A stored record that still reads as a project (anything else is skipped, never trusted). Jobs are not checked here. */
export function isProjectShape(v: unknown): v is ProjectShape {
  // Records from before jobs have none; a job that no longer reads is skipped by the caller, never trusted.
  return isObject(v) && hasProjectHead(v) && hasProjectLists(v) && isSetupShape(v['setup']) && (v['jobs'] === undefined || isArray(v['jobs']));
}

// ---------------------------------------------------------------- the strict reader

type Issue = { readonly path: string; readonly message: string };
const issue = (path: string, message: string): Issue => ({ path, message });
const isText = (v: unknown, max: number): boolean => typeof v === 'string' && v.length <= max;
// A file may be empty (the browser keeps empty notes files); an image never is.
const isFile = (f: Record<string, unknown>): boolean =>
  isText(f['name'], 255) && isNum(f['size']) && f['size'] >= 0 && Number.isInteger(f['size']) && SHA256_HEX.test(String(f['hash'])) && FILE_ROLES.includes(f['role'] as FileRole) && isText(f['note'], 2000) && isDateTime(f['addedAt']);
const isImage = (i: Record<string, unknown>): boolean =>
  (i['hash'] === undefined || (typeof i['hash'] === 'string' && SHA256_HEX.test(i['hash']))) && isText(i['name'], 255) && isNum(i['size']) && i['size'] > 0 && isNum(i['width']) && i['width'] > 0 && isNum(i['height']) && i['height'] > 0 && isDateTime(i['addedAt']);
// A link left untitled carries its URL as the title, so the title shares the URL's limit.
const isLink = (l: Record<string, unknown>): boolean => typeof l['id'] === 'string' && isText(l['title'], URL_MAX_LENGTH) && isText(l['url'], URL_MAX_LENGTH);
const isWhole = (v: unknown, min: number): boolean => isNum(v) && Number.isInteger(v) && v >= min;
/** A strict library reference: id and name, an optional positive version, and (for tools) an optional tool number. */
const isStrictRef = (v: unknown, tool = false): boolean =>
  isObject(v) && typeof v['id'] === 'string' && v['id'] !== '' && isText(v['name'], 255) && (v['version'] === undefined || isWhole(v['version'], 1))
  && (!tool || v['number'] === undefined || isWhole(v['number'], 0));

function setupIssues(s: ProjectSetup): Issue[] {
  const out: Issue[] = [];
  for (const k of ['machine', 'stock', 'material'] as const) if (s[k] !== null && !isStrictRef(s[k])) out.push(issue(`/setup/${k}`, 'must be a library reference'));
  s.tools.forEach((t, i) => { if (!isStrictRef(t, true)) out.push(issue(`/setup/tools/${i}`, 'must be a tool reference')); });
  return out;
}

function listIssues(name: string, items: readonly unknown[], ok: (item: Record<string, unknown>) => boolean): Issue[] {
  const ids = new Set<string>();
  return items.flatMap((item, i) => {
    if (!isObject(item) || typeof item['id'] !== 'string' || item['id'] === '' || !ok(item)) return [issue(`/${name}/${i}`, `is not a complete ${name.slice(0, -1)}`)];
    if (ids.has(item['id'])) return [issue(`/${name}/${i}/id`, 'repeats an id')];
    ids.add(item['id']);
    return [];
  });
}

function strictIssues(v: ProjectShape): Issue[] {
  const out: Issue[] = [];
  if (v.id === '' || !isText(v.name, 255) || !isText(v.description, 20_000)) out.push(issue('', 'needs an id, a name up to 255 and a description up to 20000 characters'));
  if (!isDateTime(v.createdAt) || !isDateTime(v.updatedAt)) out.push(issue('/createdAt', 'created and updated must be dates'));
  if (!v.tags.every((t) => isText(t, 60))) out.push(issue('/tags', 'must be short texts'));
  if (v.cover !== null && !v.images.some((i) => i.id === v.cover)) out.push(issue('/cover', 'must be one of the images'));
  out.push(...listIssues('files', v.files, isFile), ...listIssues('images', v.images, isImage), ...listIssues('links', v.links, isLink), ...setupIssues(v.setup));
  const jobs = v.jobs ?? [];
  out.push(...jobs.flatMap((j, i) => (isJob(j) ? [] : [issue(`/jobs/${i}`, 'does not read as a job')])));
  return out;
}

const FIELDS = new Set(['v', 'id', 'name', 'description', 'cover', 'images', 'files', 'links', 'setup', 'jobs', 'tags', 'createdAt', 'updatedAt']);

/**
 * A project as it may enter an account: the shape, every field, every job and every setup reference. Unknown
 * fields are refused at the root; inside known objects, extra fields are kept as data (the browser may add some
 * before the reader learns them) and never read by anything here.
 */
export function readProject(value: unknown): LibraryResult<Project> {
  if (!isProjectShape(value)) return { ok: false, issues: [issue('', 'is not a project record')] };
  const unknown = Object.keys(value).filter((k) => !FIELDS.has(k)).map((k) => issue(`/${k}`, 'is not a project field'));
  const issues = [...unknown, ...strictIssues(value)];
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: frozenCopy({ ...value, jobs: (value.jobs ?? []) as readonly Job[] }) };
}
