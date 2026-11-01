/**
 * Reads the exact W and C strings out of the safety documents, for T-S32
 * (SAFETY §5: "A CI test parses §5–§6 of this document and fails unless
 * every string matches byte for byte").
 *
 * Test code only. The parser is deliberately small and strict: anything it
 * does not recognise is an error, so a reformatted SAFETY.md fails loudly
 * instead of silently checking nothing.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** The in-repo copy of docs/run/SAFETY.md (the safety case). */
export const SAFETY_MD = readFileSync(join(REPO_ROOT, 'SAFETY.md'), 'utf8');

/**
 * The in-repo copy of docs/tools/SAFETY.md, cited by SAFETY.md as OLD-S.
 * Several §6 rows say "As OLD-S Cn"; their exact text is OLD-S §6.
 */
export const OLD_S_MD = readFileSync(join(REPO_ROOT, 'docs/safety/OLD-S.md'), 'utf8');

/** The body of `## <n>. ...` up to the next `## ` heading. Throws when absent. */
export function section(doc: string, n: number): string {
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${n}. `));
  if (start === -1) throw new Error(`no "## ${n}." section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * The double-quoted strings in a piece of Markdown, in order.
 *
 * - `\"` inside a string is a literal quote (SAFETY.md escapes quotes that
 *   are part of the text, for example `Use \"Stop job\"`).
 * - A `<placeholder>` inside a string is copied as is, including any quotes
 *   or nested `<...>` inside it (C19's placeholder quotes "made elsewhere").
 * - An unterminated string is an error.
 */
export function quotedSegments(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '"') {
      i += 1;
      continue;
    }
    i += 1;
    let value = '';
    for (;;) {
      if (i >= text.length) throw new Error(`unterminated quoted string starting ${JSON.stringify(value.slice(0, 40))}`);
      const ch = text[i] as string;
      if (ch === '\\' && text[i + 1] === '"') {
        value += '"';
        i += 2;
      } else if (ch === '<') {
        let depth = 0;
        do {
          const c = text[i];
          if (c === undefined) throw new Error(`unterminated <placeholder> in ${JSON.stringify(value.slice(0, 40))}`);
          if (c === '<') depth += 1;
          if (c === '>') depth -= 1;
          value += c;
          i += 1;
        } while (depth > 0);
      } else if (ch === '"') {
        i += 1;
        break;
      } else {
        value += ch;
        i += 1;
      }
    }
    out.push(value);
  }
  return out;
}

/**
 * §5 warnings: id → the text of its bullet, including indented continuation
 * lines (W15 has one sub-bullet per dialect).
 */
export function warningBlocks(doc: string): Map<string, string> {
  const lines = section(doc, 5).split('\n');
  const blocks = new Map<string, string>();
  let current: string | undefined;
  for (const line of lines) {
    const head = /^- \*\*(W\d+(?:-[A-Z]+)?) \(/.exec(line);
    if (head !== null) {
      current = head[1] as string;
      if (blocks.has(current)) throw new Error(`warning ${current} appears twice`);
      blocks.set(current, line);
    } else if (current !== undefined && /^\s+\S/.test(line)) {
      blocks.set(current, `${blocks.get(current) ?? ''}\n${line}`);
    } else {
      current = undefined;
    }
  }
  return blocks;
}

/** §6 confirmations: id → the whole table row. */
export function confirmationRows(doc: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of section(doc, 6).split('\n')) {
    const m = /^\| (C\d+[a-z]?) \|/.exec(line);
    if (m === null) continue;
    const id = m[1] as string;
    if (rows.has(id)) throw new Error(`confirmation ${id} appears twice`);
    rows.set(id, line);
  }
  return rows;
}

/** The numbered list of SAFETY §7, item text only, in order. */
export function cannotGuaranteeList(doc: string): string[] {
  return section(doc, 7)
    .split('\n')
    .map((l) => /^(\d+)\. (.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m, index) => {
      if (Number(m[1]) !== index + 1) throw new Error(`§7 item ${m[1]} is out of order`);
      return m[2] as string;
    });
}
