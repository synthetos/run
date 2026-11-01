/**
 * Lookups over a generated firmware table (ROADMAP P0-09).
 *
 * The generated modules are plain data; `buildTable` checks their shape once
 * (a hand edit that breaks an invariant fails at load, not later in a safety
 * decision) and returns frozen maps.
 */
import { frozenMap } from '../frozen.ts';
import type { GeneratedTable, HilTable, TokenDef } from './types.ts';

export function buildTable(gen: GeneratedTable): HilTable {
  const tokens: [string, TokenDef][] = [];
  const groups = new Map<string, string[]>();
  for (const [token, group, type, precision, persist, getter, setter] of gen.tokens) {
    if (tokens.some(([t]) => t === token)) throw new Error(`${gen.name}: duplicate token ${token}`);
    tokens.push([token, Object.freeze({ token, group, type, precision, persist, getter, setter })]);
    if (group !== '') {
      const members = groups.get(group) ?? [];
      members.push(token);
      groups.set(group, members);
    }
  }
  const status: [number, readonly string[]][] = [];
  for (const [code, names] of gen.status) {
    if (status.some(([c]) => c === code)) throw new Error(`${gen.name}: duplicate status code ${code}`);
    status.push([code, Object.freeze([...names])]);
  }
  const frozenGroups = frozenMap([...groups].map(([g, m]) => [g, Object.freeze(m)] as const));
  const none: readonly string[] = Object.freeze([]);
  return Object.freeze({
    source: Object.freeze({
      name: gen.name,
      dialectId: gen.dialectId,
      commit: gen.commit,
      tableCommit: gen.tableCommit,
      ref: gen.ref,
      fb: gen.fb,
      sha256: gen.sha256,
    }),
    tokens: frozenMap(tokens),
    status: frozenMap(status),
    members: (group: string): readonly string[] => frozenGroups.get(group) ?? none,
  });
}
