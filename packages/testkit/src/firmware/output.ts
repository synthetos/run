/**
 * How the firmware models print JSON.
 *
 * Numbers use the token's print precision from the vendored table (`%0.Nf`);
 * strings are double-quoted with `"` and `\` escaped. `js=0` (relaxed) drops
 * the quotes around keys, as TinyG's `json_relax` does; the startup banners
 * are always strict (@cite EN report.c:65-80). Key order is insertion order,
 * which is the order the firmware builds its nv list.
 */

import '../marker.ts';
export type OutValue = null | boolean | number | string | OutObject | Fixed;
export interface OutObject {
  readonly [key: string]: OutValue;
}

/** A number printed with a fixed number of decimals. */
export class Fixed {
  readonly value: number;
  readonly decimals: number;
  constructor(value: number, decimals: number) {
    this.value = value;
    this.decimals = decimals;
  }
}

export function fixed(value: number, decimals: number): Fixed {
  return new Fixed(value, decimals);
}

export function serialize(value: OutValue, relaxed = false): string {
  if (value === null) return 'null';
  if (value instanceof Fixed) return formatNumber(value.value, value.decimals);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return formatNumber(value, Number.isInteger(value) ? 0 : 3);
  if (typeof value === 'string') return quote(value);
  const parts = Object.entries(value).map(([k, v]) => `${relaxed ? k : quote(k)}:${serialize(v, relaxed)}`);
  return `{${parts.join(',')}}`;
}

function formatNumber(n: number, decimals: number): string {
  const s = n.toFixed(decimals);
  return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}

function quote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else if (c < 0x20 || c === 0x7f) out += `\\u${c.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}
