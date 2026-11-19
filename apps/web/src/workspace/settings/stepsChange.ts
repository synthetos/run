/**
 * What a scale change does to the motor's steps per unit, shown in the review before Apply (owner walk 2026-11-19:
 * a wrong microstep value moves the machine the wrong distance). Microsteps, step angle and travel per turn feed it.
 */
import type { SettingValue } from '@synthetos/schema';
import { stepsPerUnit } from '../boardFacts.ts';
import type { LiveView } from '../model.ts';
import { plannedDrafts } from './editGate.ts';
import { boardInches } from './meta.ts';
import { numberWords } from './units.ts';

type Settings = Readonly<Record<string, SettingValue>>;

const SCALE_KEY = /^([1-6])(mi|sa|tr)$/;
const num = (s: Settings, k: string): number | undefined => (typeof s[k] === 'number' ? (s[k] as number) : undefined);
const words = (v: number | null): string => (v === null ? 'Not read' : numberWords(Number(v.toFixed(3))));

function steps(s: Settings, m: string): number | null {
  return stepsPerUnit(num(s, `${m}sa`), num(s, `${m}mi`), num(s, `${m}tr`));
}

/** "Steps per mm: 1 280 → 640" for a pending scale change, or null when the key is not a scale key or nothing moves. */
export function stepsChange(key: string, view: LiveView | null): string | null {
  const m = SCALE_KEY.exec(key)?.[1];
  if (m === undefined || view === null) return null;
  const board = view.readout.settings;
  const planned = { ...board, ...plannedDrafts(view) };
  const before = steps(board, m);
  const after = steps(planned, m);
  if (before === after) return null;
  const ma = num(planned, `${m}ma`);
  const unit = ma !== undefined && ma >= 3 ? 'degree' : boardInches(view) ? 'inch' : 'mm';
  return `Steps per ${unit}: ${words(before)} → ${words(after)}`;
}
