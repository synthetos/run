/**
 * How a definition's unit reads beside a number. The unit itself comes from
 * the settings file; this only spells its symbol. Degree units attach without
 * a space ("1.8° per step", "-1°"); per-minute degree units keep one
 * ("230 400 °/min").
 */
import type { DefinitionUnit } from '@synthetos/schema';

const WORDS: Readonly<Record<DefinitionUnit, string>> = Object.freeze({
  mm: 'mm',
  'mm/min': 'mm/min',
  'mm/rev': 'mm',
  deg: '°',
  'deg/min': '°/min',
  'deg/step': '° per step',
  'Mmm/min3': 'million mm/min³',
  'Mdeg/min3': 'million °/min³',
  microsteps: '',
  s: 's',
  enum: '',
  none: '',
  text: '',
  Hz: 'Hz',
  'mm/min2': 'mm/min²',
  ratio: '',
  rpm: 'RPM',
  ms: 'ms',
});

/** The unit's symbol; with `inches`, a millimetre unit reads in inches (the board reports lengths in inches under G20). */
export function unitWords(unit: DefinitionUnit | undefined, inches = false): string {
  const words = unit === undefined ? '' : WORDS[unit];
  return inches ? words.replace('mm', 'in') : words;
}

/** A number in plain digits: thin groups of three for whole numbers ("230 400"), at most `decimals` places otherwise. */
export function numberWords(v: number, decimals?: number): string {
  if (Number.isInteger(v) && decimals === undefined) return v.toLocaleString('en-US').replace(/,/g, ' ');
  const fixed = decimals === undefined ? String(Number(v.toFixed(4))) : v.toFixed(decimals);
  const [whole, frac] = fixed.split('.');
  const grouped = Number(whole).toLocaleString('en-US').replace(/,/g, ' ');
  return frac === undefined ? grouped : `${whole === '-0' ? '-0' : grouped}.${frac}`;
}

/** A number with its unit: "1.25 mm", "1.8° per step", "20 million mm/min³"; "0.049 in" with `inches`. */
export function withUnit(v: number, unit: DefinitionUnit | undefined, decimals?: number, inches = false): string {
  const n = numberWords(v, decimals);
  const u = unitWords(unit, inches);
  if (u === '') return n;
  return u.startsWith('°') && !u.startsWith('°/') ? `${n}${u}` : `${n} ${u}`;
}
