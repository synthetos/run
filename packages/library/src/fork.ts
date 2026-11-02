/**
 * Versions and forks (MACHINING_ASSISTANT §2 "versioned record", §3 "Mine:
 * the user's own, or a fork of a built-in that inherits values until
 * edited", §9 "versioning and forking").
 *
 * - **Versions.** Tools and materials carry `id` and `version`. A saved
 *   change (`reviseRecord`) keeps the id and makes version + 1; anything
 *   that refers to a record (a stock, a cutting data entry, a fork) names
 *   both, so it always means the exact values it was made with.
 * - **Forks.** A fork is stored as its own small record: its id and version,
 *   the parent's id and version (`forkOf`), and the fields edited so far
 *   (`edits`). Every field without an edit is inherited: `resolveFork`
 *   builds the full record from the parent at `forkOf.version` with the
 *   edits on top, and validates it. Editing a field makes it the fork's own;
 *   `revertField` hands it back to the parent. `rebaseFork` moves a fork to a
 *   newer version of its parent: inherited fields follow, edited fields stay.
 *
 * An edit path is a top-level field (`coolant`, `cutting`) or one field of a
 * nested object (`physical.kc`, `geometry.diameter`); arrays are replaced
 * whole. An edit value of `null` removes an optional field in the fork. The
 * editable paths come from the record schema, so `id`, `version` and
 * `forkOf` can never be edited.
 */
import { validateSchema, type Schema } from '@synthetos/schema/json-schema';
import { frozenCopy } from './freeze.ts';
import { FORK_SCHEMA, ID_PATTERN, MATERIAL_SCHEMA, TOOL_SCHEMA } from './schemas.ts';
import type { Material, RecordRef, Tool } from './types.ts';
import { readMaterial, readTool, type LibraryIssue, type LibraryResult } from './validate.ts';

export type LibraryKind = 'tool' | 'material';

export type LibraryRecord<K extends LibraryKind> = K extends 'tool' ? Tool : Material;

export interface LibraryFork {
  readonly kind: LibraryKind;
  readonly id: string;
  readonly version: number;
  readonly forkOf: RecordRef;
  /** Edited fields by path; every other field is inherited from the parent. */
  readonly edits: Readonly<Record<string, unknown>>;
}

const READERS = Object.freeze({ tool: readTool, material: readMaterial }) as {
  readonly [K in LibraryKind]: (value: unknown) => LibraryResult<LibraryRecord<K>>;
};
const RECORD_META = new Set(['id', 'version', 'forkOf']);
const ID_RE = new RegExp(ID_PATTERN, 'u');

function pathsOf(schema: Schema): readonly string[] {
  const properties = schema['properties'] as Readonly<Record<string, Schema>>;
  const paths: string[] = [];
  for (const [key, child] of Object.entries(properties)) {
    if (RECORD_META.has(key)) continue;
    paths.push(key);
    if (child['type'] === 'object' && child['properties'] !== undefined) {
      for (const nested of Object.keys(child['properties'] as object)) paths.push(`${key}.${nested}`);
    }
  }
  return Object.freeze(paths);
}

const EDITABLE: Readonly<Record<LibraryKind, readonly string[]>> = Object.freeze({
  tool: pathsOf(TOOL_SCHEMA),
  material: pathsOf(MATERIAL_SCHEMA),
});

/** Every field path a fork of this kind may edit. */
export function editablePaths(kind: LibraryKind): readonly string[] {
  return EDITABLE[kind];
}

function issues(...list: LibraryIssue[]): LibraryResult<never> {
  return Object.freeze({ ok: false, issues: Object.freeze(list.map((i) => Object.freeze(i))) });
}

function ok<T>(value: T): LibraryResult<T> {
  return Object.freeze({ ok: true, value: frozenCopy(value) });
}

/** The reference (`id`, `version`) to one version of a record. */
export function refOf(record: RecordRef): RecordRef {
  return Object.freeze({ id: record.id, version: record.version });
}

/** Whether `ref` names exactly this version of `record`. */
export function isSameVersion(ref: RecordRef, record: RecordRef): boolean {
  return ref.id === record.id && ref.version === record.version;
}

/**
 * A saved change to a record: the same id, version + 1, the patched fields.
 * `id`, `version` and `forkOf` cannot be patched. The result is validated.
 */
export function reviseRecord<K extends LibraryKind>(kind: K, record: LibraryRecord<K>, patch: Readonly<Record<string, unknown>>): LibraryResult<LibraryRecord<K>> {
  const meta = Object.keys(patch).filter((k) => RECORD_META.has(k));
  if (meta.length > 0) return issues(...meta.map((k) => ({ path: `/${k}`, message: `${k} is not changed by a revision` })));
  const revised: Record<string, unknown> = { ...JSON.parse(JSON.stringify(record)), ...patch, version: record.version + 1 };
  return READERS[kind](revised);
}

/** A new fork of `parent` (which must be a valid record of `kind`), inheriting every field. */
export function forkRecord<K extends LibraryKind>(kind: K, parent: LibraryRecord<K>, id: string): LibraryResult<LibraryFork> {
  const valid = READERS[kind](parent);
  if (!valid.ok) return issues(...valid.issues.map((i) => ({ path: `/parent${i.path}`, message: i.message })));
  if (!ID_RE.test(id)) return issues({ path: '/id', message: `"${id}" is not a record id` });
  if (id === parent.id) return issues({ path: '/id', message: 'a fork needs its own id' });
  return ok({ kind, id, version: 1, forkOf: refOf(parent), edits: {} });
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const [head, tail] = path.split('.') as [string, string | undefined];
  if (tail === undefined) {
    if (value === null) delete target[head];
    else target[head] = value;
    return;
  }
  const child = target[head];
  // A copy: the object may be a (frozen) whole-field edit value.
  const object: Record<string, unknown> = typeof child === 'object' && child !== null && !Array.isArray(child) ? { ...(child as Record<string, unknown>) } : {};
  if (value === null) delete object[tail];
  else object[tail] = value;
  target[head] = object;
}

function depth(path: string): number {
  return path.split('.').length;
}

/** The full record a fork stands for: the parent at `forkOf.version` with the fork's edits on top. */
export function resolveFork<K extends LibraryKind>(fork: LibraryFork & { readonly kind: K }, parent: LibraryRecord<K>): LibraryResult<LibraryRecord<K>> {
  if (!isSameVersion(fork.forkOf, parent)) {
    return issues({
      path: '/forkOf',
      message: `this fork was made from ${fork.forkOf.id} version ${fork.forkOf.version}, not ${parent.id} version ${parent.version}`,
    });
  }
  const merged = JSON.parse(JSON.stringify(parent)) as Record<string, unknown>;
  // Whole fields first, then nested fields on top of them.
  const paths = Object.keys(fork.edits).sort((a, b) => depth(a) - depth(b));
  for (const path of paths) setPath(merged, path, fork.edits[path]);
  merged['id'] = fork.id;
  merged['version'] = fork.version;
  merged['forkOf'] = refOf(fork.forkOf);
  return READERS[fork.kind](merged) as LibraryResult<LibraryRecord<K>>;
}

function withEdits<K extends LibraryKind>(
  fork: LibraryFork & { readonly kind: K },
  parent: LibraryRecord<K>,
  edits: Readonly<Record<string, unknown>>,
  forkOf: RecordRef = fork.forkOf,
): LibraryResult<LibraryFork> {
  const next: LibraryFork = { kind: fork.kind, id: fork.id, version: fork.version + 1, forkOf: refOf(forkOf), edits };
  const resolved = resolveFork(next as LibraryFork & { readonly kind: K }, parent);
  if (!resolved.ok) return resolved;
  return ok(next);
}

function checkPath(kind: LibraryKind, path: string): LibraryResult<never> | null {
  return EDITABLE[kind].includes(path) ? null : issues({ path: '/edits', message: `"${path}" is not an editable ${kind} field` });
}

/**
 * Edits one field of a fork: it stops inheriting that field. Editing a whole
 * field drops the edits of its nested fields (the new value replaces them).
 * The result is validated against the parent.
 */
export function editFork<K extends LibraryKind>(
  fork: LibraryFork & { readonly kind: K },
  parent: LibraryRecord<K>,
  path: string,
  value: unknown,
): LibraryResult<LibraryFork> {
  const bad = checkPath(fork.kind, path);
  if (bad !== null) return bad;
  const edits: Record<string, unknown> = {};
  for (const [p, v] of Object.entries(fork.edits)) if (!p.startsWith(`${path}.`)) edits[p] = v;
  edits[path] = value;
  return withEdits(fork, parent, edits);
}

/** Hands a field back to the parent: the fork inherits it again (and, for a whole field, its nested fields). */
export function revertField<K extends LibraryKind>(fork: LibraryFork & { readonly kind: K }, parent: LibraryRecord<K>, path: string): LibraryResult<LibraryFork> {
  const bad = checkPath(fork.kind, path);
  if (bad !== null) return bad;
  const edits: Record<string, unknown> = {};
  for (const [p, v] of Object.entries(fork.edits)) if (p !== path && !p.startsWith(`${path}.`)) edits[p] = v;
  return withEdits(fork, parent, edits);
}

/** Whether a fork still inherits this field (no edit on it, on its parent field or on any nested field). */
export function isInherited(fork: LibraryFork, path: string): boolean {
  const top = path.split('.')[0] as string;
  return Object.keys(fork.edits).every((p) => p !== path && p !== top && !p.startsWith(`${path}.`));
}

/**
 * Moves a fork onto a newer version of its parent. Inherited fields take the
 * new parent's values; edited fields keep the fork's. Validated.
 */
export function rebaseFork<K extends LibraryKind>(fork: LibraryFork & { readonly kind: K }, newParent: LibraryRecord<K>): LibraryResult<LibraryFork> {
  if (newParent.id !== fork.forkOf.id) return issues({ path: '/forkOf/id', message: `this fork was made from ${fork.forkOf.id}, not ${newParent.id}` });
  if (newParent.version <= fork.forkOf.version) {
    return issues({ path: '/forkOf/version', message: `version ${newParent.version} is not newer than version ${fork.forkOf.version}` });
  }
  return withEdits(fork, newParent, fork.edits, newParent);
}

/** Reads a stored fork record (shape, and that every edit path is editable for its kind). */
export function readFork(value: unknown): LibraryResult<LibraryFork> {
  const found: LibraryIssue[] = validateSchema(FORK_SCHEMA, value);
  if (found.length === 0) {
    const fork = value as LibraryFork;
    for (const path of Object.keys(fork.edits)) {
      if (!EDITABLE[fork.kind].includes(path)) found.push({ path: `/edits/${path}`, message: `"${path}" is not an editable ${fork.kind} field` });
    }
  }
  if (found.length > 0) return issues(...found);
  return ok(value as LibraryFork);
}
