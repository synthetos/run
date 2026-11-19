/**
 * Family templates of a settings file (Board settings spec §4.2): one entry
 * for a repeated token (`{m}mi` for motors 1 to 4), expanded at load into one
 * raw token per instance with its cfgArray line.
 */

export type RawToken = Readonly<Record<string, unknown>>;

export interface RawFamily extends RawToken {
  readonly pattern: string;
  readonly for: Readonly<Record<string, readonly string[]>>;
  readonly rows: Readonly<Record<string, number>>;
}

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

/** Replaces every `{name}` in every string of `value` that `subst` names; others stay for the unresolved check. */
export function substitute(value: unknown, subst: Readonly<Record<string, string>>): unknown {
  if (typeof value === 'string') return value.replace(PLACEHOLDER, (whole, name: string) => subst[name] ?? whole);
  if (Array.isArray(value)) return value.map((v) => substitute(v, subst));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, subst)]));
  }
  return value;
}

/** The first placeholder left in `value`, or null. */
export function unresolved(value: unknown): string | null {
  const m = /\{[A-Za-z]+\}/.exec(JSON.stringify(value));
  return m === null ? null : m[0];
}

function product(lists: readonly (readonly string[])[]): string[][] {
  return lists.reduce<string[][]>((acc, list) => acc.flatMap((prefix) => list.map((item) => [...prefix, item])), [[]]);
}

/** One `[key, raw token]` per instance; `{A}` is the upper-case `{a}` and `{row}` the instance's cfgArray line. */
export function expandFamily(family: RawFamily): [string, RawToken][] {
  const { pattern, for: vars, rows, ...fields } = family;
  const names = Object.keys(vars);
  return product(names.map((n) => vars[n] as readonly string[])).map((instance) => {
    const subst: Record<string, string> = Object.fromEntries(names.map((n, i) => [n, instance[i] as string]));
    if (subst['a'] !== undefined) subst['A'] = subst['a'].toUpperCase();
    const key = substitute(pattern, subst) as string;
    const id = instance.join('');
    const row = rows[id];
    if (row === undefined) throw new Error(`${key}: no row for instance ${id}`);
    subst['row'] = String(row);
    return [key, substitute(fields, subst) as RawToken];
  });
}
