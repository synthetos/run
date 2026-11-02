/**
 * The bench checklist the runner steps through (ROADMAP P1-08): every
 * `| BENCH-… |` row of docs/bench/README.md, in file order. Each task adds
 * its rows there, so the runner never carries its own copy of the list.
 */

export interface ChecklistItem {
  /** `BENCH-P102-1`. */
  readonly id: string;
  /** The HIL items it covers, as written after the id (`HIL-1.1 part`), or ''. */
  readonly covers: string;
  readonly check: string;
  readonly when: string;
}

const ROW = /^\|\s*(BENCH-[A-Z0-9]+-\d+)\s*(?:\(([^)]*)\))?\s*\|(.*)\|(.*)\|\s*$/;

/** The BENCH rows of a markdown file. Throws on a BENCH row it cannot read, or a repeated id. */
export function parseChecklist(markdown: string): readonly ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const seen = new Set<string>();
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).trimEnd();
    if (!/^\|\s*BENCH-/.test(line)) continue;
    const m = ROW.exec(line);
    if (m === null) throw new Error(`checklist line ${i + 1}: not a | BENCH-id | check | when | row`);
    const id = m[1] as string;
    if (seen.has(id)) throw new Error(`checklist line ${i + 1}: ${id} appears twice`);
    seen.add(id);
    items.push(Object.freeze({ id, covers: (m[2] ?? '').trim(), check: (m[3] as string).trim(), when: (m[4] as string).trim() }));
  }
  return Object.freeze(items);
}

/** Items whose id starts with one of `prefixes` (all items when there are none). */
export function selectItems(items: readonly ChecklistItem[], prefixes: readonly string[]): readonly ChecklistItem[] {
  if (prefixes.length === 0) return items;
  return items.filter((item) => prefixes.some((p) => item.id === p || item.id.startsWith(p.endsWith('-') ? p : `${p}-`)));
}
