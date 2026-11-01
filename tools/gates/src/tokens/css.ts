/**
 * A deliberately small reader for the custom properties (`--name: value;`)
 * of CSS rule blocks, for the token drift check and the contrast table
 * (ROADMAP P0-05). It understands comments, nested at-rule blocks and
 * strings; anything unbalanced throws. Dependency-free.
 */

/** One rule block: its selector path (outermost first) and its custom properties, in order. */
export interface Block {
  readonly path: readonly string[];
  readonly properties: ReadonlyMap<string, string>;
}

function stripComments(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated comment');
      i = end + 2;
    } else if (css[i] === '"' || css[i] === "'") {
      const quote = css[i] as string;
      let j = i + 1;
      while (j < css.length && css[j] !== quote) j += css[j] === '\\' ? 2 : 1;
      if (j >= css.length) throw new Error('unterminated string');
      out += css.slice(i, j + 1);
      i = j + 1;
    } else {
      out += css[i];
      i += 1;
    }
  }
  return out;
}

/** Normalises whitespace in a selector or value. */
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Every rule block in the stylesheet, with the custom properties declared directly in it. */
export function blocks(css: string): Block[] {
  const text = stripComments(css);
  const out: { path: string[]; properties: Map<string, string> }[] = [];
  const stack: { path: string[]; properties: Map<string, string> }[] = [];
  let buffer = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      buffer += text.slice(i, j + 1);
      i = j;
    } else if (ch === '{') {
      const parent = stack[stack.length - 1];
      const block = { path: [...(parent?.path ?? []), squash(buffer)], properties: new Map<string, string>() };
      stack.push(block);
      out.push(block);
      buffer = '';
    } else if (ch === '}') {
      const block = stack.pop();
      if (block === undefined) throw new Error('unbalanced "}"');
      declare(block.properties, buffer);
      buffer = '';
    } else if (ch === ';') {
      const block = stack[stack.length - 1];
      if (block !== undefined) declare(block.properties, buffer);
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  if (stack.length > 0) throw new Error('unbalanced "{"');
  return out;
}

function declare(into: Map<string, string>, declaration: string): void {
  const d = declaration.trim();
  if (!d.startsWith('--')) return;
  const colon = d.indexOf(':');
  if (colon === -1) throw new Error(`malformed custom property: ${d}`);
  const name = d.slice(0, colon).trim();
  if (into.has(name)) throw new Error(`custom property ${name} is declared twice in one block`);
  into.set(name, squash(d.slice(colon + 1)));
}

/** The custom properties of the one block whose selector path is exactly `path`. Throws when absent or repeated. */
export function propertiesOf(css: string, path: readonly string[]): ReadonlyMap<string, string> {
  const want = path.map(squash).join(' » ');
  const found = blocks(css).filter((b) => b.path.join(' » ') === want);
  if (found.length !== 1) throw new Error(`expected exactly one block "${want}", found ${found.length}`);
  return (found[0] as Block).properties;
}
