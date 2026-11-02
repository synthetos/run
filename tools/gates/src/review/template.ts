/**
 * PR template check (ROADMAP P0-03): `.github/pull_request_template.md`
 * carries every SAFETY §8 checklist item, 1 to 41, unticked, and items 22 to
 * 41 are SAFETY §8's text verbatim, so the template cannot drift from the
 * in-repo safety case. Items 1 to 21 come from OLD-S §8, which SAFETY §8
 * adopts by reference. Dependency-free.
 */
import { CHECKLIST_ITEMS } from './safetyReview.ts';

/** SAFETY §8's own numbered items (`22. ☐ text`), keyed by number. */
export function safetyChecklistItems(safetyMd: string): Map<number, string> {
  const start = safetyMd.indexOf('\n## 8. Safety review checklist');
  if (start === -1) throw new Error('SAFETY.md has no §8');
  const end = safetyMd.indexOf('\n## 9.', start);
  const section = safetyMd.slice(start, end === -1 ? undefined : end);
  const items = new Map<number, string>();
  for (const m of section.matchAll(/^(\d+)\. ☐ (.+)$/gm)) items.set(Number(m[1]), (m[2] ?? '').trim());
  if (items.size === 0) throw new Error('SAFETY.md §8 has no numbered checklist items');
  return items;
}

/** The template's items (`- [ ] 22. text`), keyed by number. */
export function templateItems(template: string): Map<number, { ticked: boolean; text: string }> {
  const items = new Map<number, { ticked: boolean; text: string }>();
  for (const m of template.matchAll(/^- \[([ xX])\] (\d+)\. (.+)$/gm)) {
    items.set(Number(m[2]), { ticked: m[1] !== ' ', text: (m[3] ?? '').trim() });
  }
  return items;
}

export function checkTemplate(template: string, safetyMd: string): string[] {
  const problems: string[] = [];
  const items = templateItems(template);
  const safety = safetyChecklistItems(safetyMd);
  for (const n of CHECKLIST_ITEMS) {
    const item = items.get(n);
    if (item === undefined) {
      problems.push(`item ${n} is missing from the PR template`);
      continue;
    }
    if (item.ticked) problems.push(`item ${n} is pre-ticked in the PR template`);
    const expected = safety.get(n);
    if (expected !== undefined && item.text !== expected) {
      problems.push(`item ${n} differs from SAFETY.md §8: expected "${expected}"`);
    }
  }
  for (const n of safety.keys()) {
    if (!CHECKLIST_ITEMS.includes(n)) problems.push(`SAFETY.md §8 item ${n} is not in the checklist the safety-review check reads`);
  }
  for (const n of items.keys()) {
    if (!CHECKLIST_ITEMS.includes(n)) problems.push(`the PR template has an unexpected item ${n}`);
  }
  return problems;
}
