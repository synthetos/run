/**
 * Renderers (old P1-11): labels are escaped, the export has no external
 * reference and no style, the W14 footer is always there and the watermark
 * appears exactly when the E-stop rule fires. The DOM renderer builds every
 * pin as a `<g data-pin>` with createElementNS and puts labels in text nodes.
 */
import { describe, expect, it } from 'vitest';
import { renderDom, renderString, rules, SVG_NS, W14_FOOTER, W14_WATERMARK, escapeXml, type Diagram, type SvgDocumentLike, type SvgElementLike } from '../src/index.ts';
import { V8, part, reference, withParts } from './fixtures.ts';

const noEstop = (): Diagram => ({ ...reference(), parts: reference().parts.filter((p) => p.id !== 'estop'), wires: reference().wires.filter((w) => !w.from.startsWith('estop') && w.to !== 'estop:nc1a') });
const XSS = '<script>alert(1)</script>';

class FakeEl implements SvgElementLike {
  readonly attrs = new Map<string, string>();
  readonly children: FakeEl[] = [];
  textContent: string | null = null;
  readonly ns: string;
  readonly name: string;
  constructor(ns: string, name: string) {
    this.ns = ns;
    this.name = name;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  appendChild(c: never): unknown {
    this.children.push(c as FakeEl);
    return c;
  }
  all(pred: (e: FakeEl) => boolean): FakeEl[] {
    return [...(pred(this) ? [this] : []), ...this.children.flatMap((c) => c.all(pred))];
  }
}
const fakeDoc: SvgDocumentLike = { createElementNS: (ns, name) => new FakeEl(ns, name) };

describe('renderString (export)', () => {
  const svg = (d: Diagram) => renderString(d, V8, rules(d, V8, 'tinyg-en'), { paper: 'letter' });

  it('a label <script>alert(1)</script> renders as literal text', () => {
    const out = svg(withParts(reference(), [part('evil', 'buffer', {}, XSS)]));
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('has no external reference and no style: the only http is the SVG namespace', () => {
    const out = svg(reference());
    expect(out.replaceAll(SVG_NS, '')).not.toMatch(/http/i);
    expect(out).not.toMatch(/\sstyle=|<style|var\(--|href=|url\(/);
    expect(out).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(out).toContain('<title>');
    expect(out).toContain('<desc>');
  });

  it('always carries the W14 footer; the watermark only without a compliant E-stop', () => {
    expect(svg(reference())).toContain(escapeXml(W14_FOOTER));
    expect(svg(reference())).not.toContain(W14_WATERMARK);
    expect(svg(noEstop())).toContain(W14_WATERMARK);
    expect(svg(noEstop())).toContain(escapeXml(W14_FOOTER));
  });

  it('includes the wire table, the BOM and the checklist', () => {
    const out = svg(reference());
    expect(out).toContain('Wire table');
    expect(out).toContain('Bill of materials');
    expect(out).toContain('Checklist');
    expect(out).toContain('board J7.3');
  });

  it('A4 uses the A4 page size', () => {
    expect(renderString(reference(), V8, [], { paper: 'a4' })).toContain('width="210mm"');
  });
});

describe('renderDom', () => {
  it('builds every board and part pin as a <g data-pin> in the SVG namespace', () => {
    const root = renderDom(fakeDoc, reference(), V8, []) as FakeEl;
    expect(root.name).toBe('svg');
    expect(root.all((e) => e.ns !== SVG_NS)).toEqual([]);
    const pins = root.all((e) => e.name === 'g' && e.attrs.has('data-pin')).map((e) => e.attrs.get('data-pin'));
    expect(pins).toContain('J7.3');
    expect(pins).toContain('sx:sig');
    expect(root.all((e) => e.attrs.has('data-wire'))).toHaveLength(reference().wires.length);
  });

  it('puts labels in text nodes, never in attributes or markup', () => {
    const root = renderDom(fakeDoc, withParts(reference(), [part('evil', 'buffer', {}, XSS)]), V8, []) as FakeEl;
    expect(root.all((e) => e.textContent === XSS)).toHaveLength(1);
    expect(root.all((e) => [...e.attrs.values()].some((v) => v.includes('<')))).toEqual([]);
  });

  it('marks findings at their pins and shows the watermark when the E-stop rule fires', () => {
    const d = noEstop();
    const root = renderDom(fakeDoc, d, V8, rules(d, V8, 'tinyg-en')) as FakeEl;
    expect(root.all((e) => e.attrs.get('data-watermark') === 'w14')).toHaveLength(1);
    const ok = renderDom(fakeDoc, reference(), V8, rules(reference(), V8, 'tinyg-en')) as FakeEl;
    expect(ok.all((e) => e.attrs.get('data-watermark') === 'w14')).toEqual([]);
  });
});
