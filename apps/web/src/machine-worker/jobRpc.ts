export const MAX_BREAKPOINTS = 1000;
import { plainKeys } from './plainKeys.ts';
export type JobCommand =
  | { readonly op: 'load'; readonly name: string; readonly text: string; readonly c22: boolean }
  | { readonly op: 'override'; readonly channel: 'feed' | 'spindle'; readonly percent: number }
  | { readonly op: 'unload' }
  | { readonly op: 'start'; readonly breakpoints: readonly number[]; readonly confirm: { readonly unhomed: boolean; readonly workZero: boolean; readonly spindle: boolean; readonly travel: string | null } }
  | { readonly op: 'resume'; readonly skip: boolean; readonly spindleRestart: boolean }
  | { readonly op: 'breakpoints'; readonly lines: readonly number[] }
  | { readonly op: 'lineModeMemory'; readonly epoch: number; readonly remembered: 0 | 1 | null };
export const MAX_JOB_NAME = 200;
export const MAX_JOB_TEXT = 50 * 1024 * 1024;
function lineList(value: unknown): readonly number[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_BREAKPOINTS) return null;
  const list: unknown[] = value;
  if (!list.every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1)) return null;
  return Object.freeze([...(list as number[])]);
}

/** A job command, strictly: exactly its keys, known values. The session checks the rest. */

function load(c: Record<string, unknown>, keys: string): JobCommand | null {
  const { name, text, c22 } = c;
  if (keys !== 'c22,name,op,text' || typeof name !== 'string' || name.length === 0 || name.length > MAX_JOB_NAME) return null;
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_JOB_TEXT || typeof c22 !== 'boolean') return null;
  return Object.freeze({ op: 'load', name, text, c22 });
}
function start(c: Record<string, unknown>, keys: string): JobCommand | null {
  const breakpoints = lineList(c['breakpoints']), confirm = c['confirm'];
  if (keys !== 'breakpoints,confirm,op' || breakpoints === null || plainKeys(confirm) !== 'spindle,travel,unhomed,workZero') return null;
  const f = confirm as Record<string, unknown>;
  if (typeof f['unhomed'] !== 'boolean' || typeof f['workZero'] !== 'boolean' || typeof f['spindle'] !== 'boolean') return null;
  if (!(f['travel'] === null || (typeof f['travel'] === 'string' && f['travel'].length <= 600))) return null;
  return Object.freeze({ op: 'start', breakpoints, confirm: Object.freeze({ unhomed: f['unhomed'], workZero: f['workZero'], spindle: f['spindle'], travel: f['travel'] }) });
}
function override(c: Record<string, unknown>, keys: string): JobCommand | null {
  const { channel, percent } = c;
  if (keys !== 'channel,op,percent' || (channel !== 'feed' && channel !== 'spindle')) return null;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 10 || percent > 150 || percent % 10 !== 0) return null;
  return Object.freeze({ op: 'override', channel, percent });
}
function lineMode(c: Record<string, unknown>, keys: string): JobCommand | null {
  const { epoch, remembered } = c;
  if (keys !== 'epoch,op,remembered' || typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) return null;
  if (remembered !== null && remembered !== 0 && remembered !== 1) return null;
  return Object.freeze({ op: 'lineModeMemory', epoch, remembered });
}
export function parseJobCommand(value: unknown): JobCommand | null {
  const keys = plainKeys(value);
  if (keys === null) return null;
  const c = value as Record<string, unknown>;
  switch (c['op']) {
    case 'load': return load(c, keys);
    case 'start': return start(c, keys);
    case 'override': return override(c, keys);
    case 'lineModeMemory': return lineMode(c, keys);
    case 'unload': return keys === 'op' ? Object.freeze({ op: 'unload' }) : null;
    case 'resume':
      if (keys !== 'op,skip,spindleRestart' || typeof c['skip'] !== 'boolean' || typeof c['spindleRestart'] !== 'boolean') return null;
      return Object.freeze({ op: 'resume', skip: c['skip'], spindleRestart: c['spindleRestart'] });
    case 'breakpoints': {
      const lines = lineList(c['lines']);
      return keys === 'lines,op' && lines !== null ? Object.freeze({ op: 'breakpoints', lines }) : null;
    }
    default: return null;
  }
}
