/**
 * One-off extractor for the forum fixtures (ROADMAP P0-07 acceptance; old
 * ROADMAP P0-07: "extracted by a one-off script into
 * test-fixtures/forum-json/*.txt with source topic URLs").
 *
 * Usage (from the repository root, with the synthetos.com site checked out):
 *   node packages/protocol/test/fixtures/extractForumJson.ts \
 *     <site>/src/data/forum/topics.jsonl test-fixtures/forum-json <site-commit>
 *
 * It is not run by CI (the site repository is not available there); its
 * output is committed and reviewed. It finds every firmware output line
 * (`{"r":`, `{"sr":`, `{"qr":`, `{"er":`, quoted or bare keys) quoted in a
 * post, skips host commands (`{"sr":null}`, `{"sr":{"posx":true,...}}`,
 * `{"qr":n}`), and writes one file per topic: `<kind>\t<line>` rows under the
 * topic URL. The kind comes from a deliberately simple oracle built on
 * JSON.parse plus the EN-HIL bare-key rewrite (tests/hil/tinyg_hil/protocol.py
 * `loads`), independent of src/classify.ts; every row was then reviewed by
 * hand, and a disagreement with the classifier fails the fixture test.
 *
 * After extraction, every board `id` (a unique per-chip value) was replaced
 * by hand with a synthetic id of the same shape (`9H0000-AAA`), and the
 * footer checksum recomputed where the line carried one. Redo that after
 * any re-extraction.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Topic {
  readonly slug: string;
  readonly path: string;
  readonly text?: string;
  readonly html?: string;
  readonly replies?: readonly { readonly id: number; readonly html?: string }[];
}

const CANDIDATE = /\{\s*["“”]?(sr|qr|r|er)["“”]?\s*:/g;
const COMMAND_SCALAR = /^\{\s*"?(sr|qr)"?\s*:\s*(null|n|""|true|t)\s*\}$/;
const COMMAND_SR_SET = /^\{\s*"?sr"?\s*:\s*\{(\s*"?\w+"?\s*:\s*(true|false|t|f|null|n)\s*,?)*\s*\}\s*\}$/;
const BARE_KEY = /([{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g;

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|pre|blockquote|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** The balanced `{...}` starting at `start`, or the rest of the line when it never closes. */
function span(line: string, start: number): string {
  let depth = 0;
  let inString = false;
  for (let i = start; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return line.slice(start, i + 1);
  }
  return line.slice(start).trimEnd();
}

function loads(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(s.replace(BARE_KEY, '$1"$2":'));
    } catch {
      return undefined;
    }
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isUint = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function checksum440(line: string): number {
  let h = 0;
  for (const b of new TextEncoder().encode(line.slice(0, line.lastIndexOf(',')))) h = (Math.imul(31, h) + b) >>> 0;
  return h % 9999;
}

function oracle(line: string): string {
  const v = loads(line);
  if (!isObj(v)) return 'Garbled';
  if (isObj(v.r)) {
    const f = v.f ?? v.r.f;
    if (!Array.isArray(f) || !f.every(isUint) || ![1, 2, 3].includes(f[0] as number)) return 'Garbled';
    if (f.length === 4 && f[0] === 1 && f[3] !== checksum440(line)) return 'Garbled';
    const ident = ['fv', 'fb', 'hp', 'hv', 'id'].some((k) => k in (v.r as object));
    return typeof v.r.msg === 'string' && ident ? 'Banner' : 'Response';
  }
  const keys = Object.keys(v);
  if (keys.length === 1 && isObj(v.sr)) return 'msg' in v.sr ? 'Banner' : 'StatusReport';
  if (isUint(v.qr)) return 'QueueReport';
  if (keys.length === 1 && isObj(v.er) && isUint(v.er.st)) return 'Exception';
  return 'Garbled';
}

function main(): void {
  const [topicsPath, outDir, siteCommit] = process.argv.slice(2);
  if (!topicsPath || !outDir || !siteCommit) throw new Error('usage: extractForumJson.ts <topics.jsonl> <outDir> <site-commit>');
  mkdirSync(outDir, { recursive: true });
  let topics = 0;
  let rows = 0;
  for (const raw of readFileSync(topicsPath, 'utf8').split('\n')) {
    if (raw.trim() === '') continue;
    const t = JSON.parse(raw) as Topic;
    const posts: [string, string][] = [['topic', t.text ?? htmlToText(t.html ?? '')]];
    for (const r of t.replies ?? []) posts.push([`reply ${r.id}`, htmlToText(r.html ?? '')]);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const [label, body] of posts) {
      const lines: string[] = [];
      for (const textLine of body.split('\n')) {
        let covered = -1;
        for (const m of textLine.matchAll(CANDIDATE)) {
          if (m.index < covered) continue;
          const s = span(textLine, m.index);
          covered = m.index + s.length;
          if (COMMAND_SCALAR.test(s) || COMMAND_SR_SET.test(s) || s.includes('\t') || seen.has(s)) continue;
          seen.add(s);
          lines.push(`${oracle(s)}\t${s}`);
        }
      }
      if (lines.length > 0) out.push(`# ${label}`, ...lines);
    }
    if (out.length === 0) continue;
    topics++;
    rows += out.filter((l) => !l.startsWith('#')).length;
    const header = [
      `# Firmware JSON lines quoted in an archived synthetos.com forum topic.`,
      `# Extracted by packages/protocol/test/fixtures/extractForumJson.ts from`,
      `# synthetos.com src/data/forum/topics.jsonl @ ${siteCommit}, then reviewed.`,
      `# Rows: <expected kind><TAB><line exactly as quoted in the post>.`,
      `# source: https://synthetos.com${t.path}`,
    ];
    writeFileSync(join(outDir, `${t.slug}.txt`), [...header, ...out, ''].join('\n'));
  }
  process.stdout.write(`${topics} topics, ${rows} lines\n`);
}

main();
