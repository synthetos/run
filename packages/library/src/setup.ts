/**
 * The account's setup record (docs/superpowers/specs/2026-11-16-first-run-design.md §6.1): one document per
 * account, id `setup`, holding whether the setup wizard was dismissed, the step to resume on, the steps finished,
 * the homing choice (choice only; never a board setting) and the ids of what the wizard created. `stock` was
 * written by the first wizard's step 5; OD-42 took stock out of the wizard, so nothing writes it now, but records
 * that carry one still read (no migration). The type and the strict reader live here so the browser and the
 * account store agree.
 */
import { frozenCopy } from './freeze.ts';
import { isArray, isDateTime, isObject } from './shape.ts';
import type { Stock } from './types.ts';
import { readStock, type LibraryResult } from './validate.ts';

export const SETUP_RECORD_ID = 'setup';
export type HomingChoice = 'switches' | 'none';
const HOMING: readonly HomingChoice[] = ['switches', 'none'];

export interface SetupRecord {
  readonly v: 1;
  readonly id: typeof SETUP_RECORD_ID;
  readonly dismissed: boolean;
  /** 1..7: the step to resume on. */
  readonly step: number;
  /** Steps finished (not skipped), each 1..7, unique. */
  readonly done: readonly number[];
  readonly homing: HomingChoice | null;
  /** Older records only (OD-42): read, never written. */
  readonly stock: Stock | null;
  readonly toolId: string | null;
  readonly machineId: string | null;
  readonly projectId: string | null;
  readonly updatedAt: string;
}

export const EMPTY_SETUP_RECORD: SetupRecord = Object.freeze({
  v: 1, id: SETUP_RECORD_ID, dismissed: false, step: 1, done: Object.freeze([]) as readonly number[],
  homing: null, stock: null, toolId: null, machineId: null, projectId: null, updatedAt: '1970-01-01T00:00:00.000Z',
});

type Issue = { readonly path: string; readonly message: string };
const issue = (path: string, message: string): Issue => ({ path, message });
const isStep = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 7;
const isIdOrNull = (v: unknown): boolean => v === null || (typeof v === 'string' && v !== '' && v.length <= 64);
const FIELDS = new Set(['v', 'id', 'dismissed', 'step', 'done', 'homing', 'stock', 'toolId', 'machineId', 'projectId', 'updatedAt']);

function headIssues(v: Record<string, unknown>): Issue[] {
  const out: Issue[] = [];
  if (v['v'] !== 1) out.push(issue('/v', 'must be 1'));
  if (v['id'] !== SETUP_RECORD_ID) out.push(issue('/id', `must be ${SETUP_RECORD_ID}`));
  if (typeof v['dismissed'] !== 'boolean') out.push(issue('/dismissed', 'must be true or false'));
  if (!isStep(v['step'])) out.push(issue('/step', 'must be a step from 1 to 7'));
  if (!isArray(v['done']) || !v['done'].every(isStep) || new Set(v['done']).size !== v['done'].length) out.push(issue('/done', 'must list distinct steps from 1 to 7'));
  if (!isDateTime(v['updatedAt'])) out.push(issue('/updatedAt', 'must be a date'));
  return out;
}

function choiceIssues(v: Record<string, unknown>): Issue[] {
  const out: Issue[] = [];
  if (v['homing'] !== null && !HOMING.includes(v['homing'] as HomingChoice)) out.push(issue('/homing', 'must be switches, none or null'));
  if (v['stock'] !== null && !readStock(v['stock']).ok) out.push(issue('/stock', 'must be a stock or null'));
  for (const k of ['toolId', 'machineId', 'projectId'] as const) if (!isIdOrNull(v[k])) out.push(issue(`/${k}`, 'must be an id or null'));
  return out;
}

/** A setup record as it may enter an account: every field checked, unknown fields refused. */
export function readSetup(value: unknown): LibraryResult<SetupRecord> {
  if (!isObject(value)) return { ok: false, issues: [issue('', 'must be an object')] };
  const unknown = Object.keys(value).filter((k) => !FIELDS.has(k)).map((k) => issue(`/${k}`, 'is not a setup field'));
  const issues = [...unknown, ...headIssues(value), ...choiceIssues(value)];
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: frozenCopy(value as unknown as SetupRecord) };
}
