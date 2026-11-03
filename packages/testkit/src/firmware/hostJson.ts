/**
 * The models' reader for JSON command lines from the host.
 *
 * TinyG's tokenizer is relaxed: keys may be bare or quoted and are folded to
 * lower case; whitespace outside strings is dropped (@cite EN
 * json_parser.c:348-361). This reader is written independently of
 * `@synthetos/protocol` (which parses controller OUTPUT), so the models never
 * share a parser with the code they test.
 *
 * Accepted values: null (also `n`), true / false (also `t` / `f`), numbers,
 * double-quoted strings, and one level of nested object (group SETs such as
 * `{"sr":{"line":true}}`).
 */

import '../marker.ts';
export type HostValue = null | boolean | number | string | HostPairs;
export interface HostPairs {
  readonly pairs: readonly (readonly [string, HostValue])[];
}

export type HostJsonResult = { readonly ok: true; readonly pairs: readonly (readonly [string, HostValue])[] } | { readonly ok: false };

export function parseHostJson(line: string): HostJsonResult {
  const p = new Reader(line);
  try {
    p.ws();
    const obj = p.object(0);
    p.ws();
    if (!p.atEnd()) return { ok: false };
    return { ok: true, pairs: obj.pairs };
  } catch {
    return { ok: false };
  }
}

class Reader {
  #i = 0;
  readonly #s: string;

  constructor(s: string) {
    this.#s = s;
  }

  atEnd(): boolean {
    return this.#i >= this.#s.length;
  }

  ws(): void {
    while (this.#i < this.#s.length && /\s/.test(this.#s[this.#i] as string)) this.#i++;
  }

  #peek(): string {
    return this.#s[this.#i] ?? '';
  }

  #expect(c: string): void {
    if (this.#peek() !== c) throw new Error(`expected ${c}`);
    this.#i++;
  }

  object(depth: number): HostPairs {
    if (depth > 1) throw new Error('too deep');
    this.#expect('{');
    const pairs: [string, HostValue][] = [];
    this.ws();
    if (this.#peek() === '}') {
      this.#i++;
      return { pairs };
    }
    for (;;) {
      this.ws();
      const key = this.#key();
      this.ws();
      this.#expect(':');
      this.ws();
      pairs.push([key, this.#value(depth)]);
      this.ws();
      if (this.#peek() === ',') {
        this.#i++;
        continue;
      }
      this.#expect('}');
      return { pairs };
    }
  }

  #key(): string {
    if (this.#peek() === '"') return this.#string().toLowerCase();
    const m = /^[A-Za-z0-9_]+/.exec(this.#s.slice(this.#i));
    if (m === null) throw new Error('bad key');
    this.#i += m[0].length;
    return m[0].toLowerCase();
  }

  #string(): string {
    this.#expect('"');
    let out = '';
    for (;;) {
      const c = this.#peek();
      if (c === '') throw new Error('unterminated string');
      this.#i++;
      if (c === '"') return out;
      if (c === '\\') {
        const e = this.#peek();
        this.#i++;
        out += e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e;
        continue;
      }
      out += c;
    }
  }

  #value(depth: number): HostValue {
    const c = this.#peek();
    if (c === '"') return this.#string();
    if (c === '{') return this.object(depth + 1);
    const m = /^[A-Za-z0-9_.+-]+/.exec(this.#s.slice(this.#i));
    if (m === null) throw new Error('bad value');
    this.#i += m[0].length;
    const word = m[0].toLowerCase();
    if (word === 'null' || word === 'n') return null;
    if (word === 'true' || word === 't') return true;
    if (word === 'false' || word === 'f') return false;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(word)) throw new Error('bad number');
    return Number(word);
  }
}
