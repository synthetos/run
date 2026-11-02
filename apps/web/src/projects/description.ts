/**
 * A project's description: plain text with simple formatting (PROJECTS.md
 * §1), rendered as Preact elements, never as markup. Paragraphs are split by
 * blank lines; lines starting with "- " or "* " make a list, "1. " a numbered
 * list; **bold** works; `[title](https://…)` and bare http(s) addresses
 * become links, but only through `safeExternalLink` (new tab, noopener,
 * noreferrer, nofollow). Anything else is shown as the text it is.
 */
import { h, type ComponentChild } from 'preact';
import { safeExternalLink } from '../workspace/library.ts';

export type Block = { readonly kind: 'p'; readonly text: string } | { readonly kind: 'ul' | 'ol'; readonly items: readonly string[] };

/** The description's blocks. Pure. */
export function blocks(text: string): readonly Block[] {
  const out: Block[] = [];
  for (const chunk of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) out.push({ kind: 'ul', items: lines.map((l) => l.replace(/^\s*[-*]\s+/, '')) });
    else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) out.push({ kind: 'ol', items: lines.map((l) => l.replace(/^\s*\d+[.)]\s+/, '')) });
    else out.push({ kind: 'p', text: lines.join('\n') });
  }
  return out;
}

const INLINE = /\[([^\]\n]{1,200})\]\(([^)\s]{1,2048})\)|(https?:\/\/[^\s<>()]{1,2048})|\*\*([^*\n]{1,400})\*\*/g;

/** Inline text: links (only when safeExternalLink accepts them), bold, line breaks. */
export function inline(text: string): ComponentChild[] {
  const out: ComponentChild[] = [];
  let last = 0;
  let key = 0;
  const plain = (s: string): void => {
    s.split('\n').forEach((part, i) => {
      if (i > 0) out.push(h('br', { key: `b${key++}` }));
      if (part !== '') out.push(part);
    });
  };
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    plain(text.slice(last, at));
    last = at + m[0].length;
    if (m[4] !== undefined) {
      out.push(h('strong', { key: `s${key++}` }, m[4]));
      continue;
    }
    // A bare address keeps sentence punctuation outside the link.
    const bare = m[3] === undefined ? null : m[3].replace(/[.,;:!?]+$/, '');
    if (bare !== null && m[3] !== undefined && bare.length < m[3].length) last -= m[3].length - bare.length;
    const url = (m[2] ?? bare) as string;
    const label = m[1] ?? url;
    const link = safeExternalLink(url);
    if (link === null) plain(m[1] === undefined ? url : m[0]);
    else out.push(h('a', { key: `a${key++}`, href: link.href, rel: link.rel, target: link.target }, label));
  }
  plain(text.slice(last));
  return out;
}

export function Description({ text }: { readonly text: string }): ComponentChild {
  return h(
    'div',
    { class: 'description-view', 'data-project': 'description' },
    blocks(text).map((b, i) =>
      b.kind === 'p' ? h('p', { key: String(i) }, inline(b.text)) : h(b.kind, { key: String(i) }, b.items.map((item, j) => h('li', { key: String(j) }, inline(item)))),
    ),
  );
}
