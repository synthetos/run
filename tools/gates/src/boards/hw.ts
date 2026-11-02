/**
 * Private-hardware overlay derivation (ROADMAP TB-05a, RUN_PLAN §5.1 rule 6).
 * LOCAL ONLY: it reads the owner's private KiCad sources, which are never
 * committed, published or named in this repository.
 *
 * From KiCad 6+ schematics (`.kicad_sch`) it derives connector facts only: a
 * connector's reference designator, its value as a label, and each pin's
 * number and name (power pins mapped to a net). The output is an overlay
 * fragment whose every `src` is an opaque reference (`hw:` plus 12 hex of a
 * hash of the file's relative path and commit), with `verified:
 * "hardware-repo"`. Nothing else leaves the tool: no file names, paths,
 * images, footprints, or other symbols. A string that still looks like a path
 * makes it throw rather than print.
 *
 * Signal mapping (which connector pin carries which firmware signal) is a
 * review step: the owner adds `signal` by hand, and the generator then checks
 * it against the generated pin map.
 */
import { createHash } from 'node:crypto';
import type { BoardConnector, ConnectorNet } from '../../../../packages/schema/src/boards.ts';

type Sexpr = string | Sexpr[];

/** Parse one KiCad s-expression document. */
export function parseSexpr(text: string): Sexpr {
  const stack: Sexpr[][] = [[]];
  const re = /\s*(?:(\()|(\))|"((?:[^"\\]|\\.)*)"|([^\s()"]+))/gy;
  let m: RegExpExecArray | null;
  while (re.lastIndex < text.length && (m = re.exec(text)) !== null) {
    const top = stack[stack.length - 1] as Sexpr[];
    if (m[1] !== undefined) {
      const list: Sexpr[] = [];
      top.push(list);
      stack.push(list);
    } else if (m[2] !== undefined) {
      if (stack.length === 1) throw new Error('gen-boards-hw: unbalanced ")"');
      stack.pop();
    } else if (m[3] !== undefined) top.push(m[3].replace(/\\(.)/g, '$1'));
    else if (m[4] !== undefined) top.push(m[4]);
    if (/^\s*$/.test(text.slice(re.lastIndex))) break;
  }
  if (stack.length !== 1) throw new Error('gen-boards-hw: unbalanced "("');
  const root = stack[0] as Sexpr[];
  if (root.length !== 1) throw new Error('gen-boards-hw: expected one top-level expression');
  return root[0] as Sexpr;
}

const head = (s: Sexpr): string | undefined => (Array.isArray(s) && typeof s[0] === 'string' ? s[0] : undefined);
const children = (s: Sexpr, name: string): Sexpr[][] => (Array.isArray(s) ? (s.filter((c) => head(c) === name) as Sexpr[][]) : []);
const atom = (s: Sexpr[] | undefined, i: number): string | undefined => {
  const v = s?.[i];
  return typeof v === 'string' ? v : undefined;
};
const property = (sym: Sexpr, key: string): string | undefined => atom(children(sym, 'property').find((p) => atom(p, 1) === key), 2);

const NETS: readonly [RegExp, ConnectorNet][] = [
  [/^(GND|0V|VSS)$/i, 'GND'],
  [/^\+?3\.?3V?$|^3V3$/i, '3V3'],
  [/^\+?5V?$/i, '5V'],
  [/^\+?12V?$/i, '12V'],
  [/^V_?MOT(OR)?$|^VM$/i, 'VMOT'],
];

/** Collapse a KiCad string to a safe label, or undefined when nothing safe is left. */
function label(text: string | undefined, max: number): string | undefined {
  if (text === undefined) return undefined;
  const clean = text
    .replace(/[^A-Za-z0-9 .+\-#~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return clean.length === 0 || clean === '~' ? undefined : clean;
}

export interface HwFile {
  /** Path relative to the hardware repository root (hashed, never printed). */
  readonly relPath: string;
  readonly text: string;
}

export const opaqueSrc = (relPath: string, commit: string): string => `hw:${createHash('sha256').update(`${relPath}@${commit}`).digest('hex').slice(0, 12)}`;

/** Derive the connectors of one schematic set. Refs default to J/P/X designators. */
export function deriveConnectors(files: readonly HwFile[], commit: string, refPattern: RegExp = /^(J|P|X|CN)[0-9]{1,3}$/): BoardConnector[] {
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error('gen-boards-hw: commit must be a hex sha');
  const out = new Map<string, BoardConnector>();
  for (const file of files) {
    const doc = parseSexpr(file.text);
    if (head(doc) !== 'kicad_sch') throw new Error('gen-boards-hw: not a KiCad 6+ schematic');
    const libs = new Map<string, Sexpr[]>();
    for (const lib of children(doc, 'lib_symbols').flatMap((l) => children(l, 'symbol'))) {
      const name = atom(lib, 1);
      if (name !== undefined) libs.set(name, lib);
    }
    for (const sym of children(doc, 'symbol')) {
      const ref = property(sym, 'Reference');
      if (ref === undefined || !refPattern.test(ref) || out.has(ref)) continue;
      const lib = libs.get(atom(children(sym, 'lib_id')[0], 1) ?? '');
      if (lib === undefined) continue;
      // Pins live in the lib symbol or its unit sub-symbols.
      const pinNodes = [...children(lib, 'pin'), ...children(lib, 'symbol').flatMap((u) => children(u, 'pin'))];
      const pins = pinNodes
        .map((p) => {
          const n = Number(atom(children(p, 'number')[0], 1));
          const name = label(atom(children(p, 'name')[0], 1), 24) ?? `${n}`;
          const net = NETS.find(([re]) => re.test(name))?.[1];
          return { n, label: name, ...(net === undefined ? {} : { net }) };
        })
        .filter((p) => Number.isInteger(p.n) && p.n >= 1 && p.n <= 40)
        .sort((a, b) => a.n - b.n)
        .filter((p, i, all) => i === 0 || (all[i - 1] as { n: number }).n !== p.n);
      if (pins.length === 0) continue;
      out.set(ref, { id: ref, label: label(property(sym, 'Value'), 60) ?? ref, pins, src: opaqueSrc(file.relPath, commit), verified: 'hardware-repo' });
    }
  }
  const connectors = [...out.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  assertNothingLeaks(connectors, files);
  return connectors;
}

/** Throw if any derived string looks like a path or contains a source file name. */
export function assertNothingLeaks(value: unknown, files: readonly HwFile[]): void {
  const text = JSON.stringify(value);
  const names = files.flatMap((f) => f.relPath.split(/[\\/]/)).filter((s) => s.length > 3);
  if (/[\\/]|\.kicad|\.sch\b|\.pdf|\.png|\.jpg/i.test(text) || names.some((n) => text.includes(n))) {
    throw new Error('gen-boards-hw: derived output contains a path or file name; refusing to print it');
  }
}
