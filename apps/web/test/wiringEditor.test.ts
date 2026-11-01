/**
 * Wiring editor (ROADMAP TB-05; old P1-12 acceptance, without a browser):
 * the reference 3-axis TinyG diagram built with the keyboard path only (the
 * "Connect to…" actions), expected settings writing exactly one key per
 * accept, a typed confirmation for each key class that writes nothing until
 * the word matches and nothing on Cancel, the watermark notice on and off,
 * and the export passing the Trusted Types export allowlist.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { BOARD_DEFINITIONS } from '@synthetos/schema';
import { emptyDiagram, expectedSettings, renderString, rules, type Diagram, type PartKind, type WiringBoard } from '@synthetos/wiring';
import { createReducer, initialState, type EditorAction, type EditorState } from '../src/wiring/editorState.ts';
import { DEFAULT_FORM, WiringEditorView } from '../src/wiring/WiringEditor.ts';
import { WIRING_BOARDS } from '../src/pages/wiring/WiringPage.ts';
import { brandSvgExport } from '../src/security/tt.ts';
import { all, byAttr, root, text } from './tree.ts';

const V8: WiringBoard = BOARD_DEFINITIONS.find((b) => b.id === 'tinyg-v8@8') as WiringBoard;
const reduce = createReducer(V8);
const run = (actions: readonly EditorAction[], s: EditorState = initialState(emptyDiagram(V8.id))) => actions.reduce(reduce, s);
const id = (s: EditorState, label: string) => s.diagram.parts.find((p) => p.label === label)?.id as string;

/** Adds the parts, then wires them with "Connect to…" only (pin id, then the pin to connect it to). */
function keyboardBuild(): EditorState {
  const add: [PartKind, string][] = [
    ['mains', 'Mains'],
    ['estop', 'E-stop'],
    ['psu', 'Motor PSU'],
    ['switch', 'X min'],
    ['switch', 'Y min'],
    ['switch', 'Z max'],
    ['stepper', 'X motor'],
  ];
  let s = run(add.map(([kind, label]) => ({ type: 'addPart', kind, label })));
  const c = (a: string, b: string): EditorAction => ({ type: 'connect', from: a, to: b });
  const [m, e, p, x, y, z] = ['Mains', 'E-stop', 'Motor PSU', 'X min', 'Y min', 'Z max'].map((l) => id(s, l));
  s = run(
    [
      c(`${m}:L`, `${e}:nc1a`),
      c(`${e}:nc1b`, `${p}:L`),
      c(`${m}:N`, `${p}:N`),
      c(`${m}:PE`, `${p}:PE`),
      c(`${p}:+v`, 'board:J1.2'),
      c(`${p}:-v`, 'board:J1.1'),
      c(`${x}:sig`, 'board:J7.3'),
      c(`${x}:com`, 'board:J7.1'),
      c(`${y}:sig`, 'board:J7.5'),
      c(`${y}:com`, 'board:J7.1'),
      c(`${z}:sig`, 'board:J8.4'),
      c(`${z}:com`, 'board:J8.1'),
    ],
    s,
  );
  return s;
}

const view = (s: EditorState, board: WiringBoard = V8) =>
  root(h(WiringEditorView, { board, dialect: 'tinyg-en', state: s, dispatch: () => undefined, form: DEFAULT_FORM, setForm: () => undefined, canvas: null }));

describe('editor state', () => {
  it('builds the reference 3-axis TinyG diagram with the keyboard path only; no BLOCK and no E-stop flag', () => {
    const s = keyboardBuild();
    expect(s.error).toBeNull();
    expect(s.diagram.wires).toHaveLength(12);
    const f = rules(s.diagram, V8, 'tinyg-en');
    expect(f.filter((x) => x.severity === 'block' || x.severity === 'estop')).toEqual([]);
  });

  it('refuses a connection to a pin that does not exist, and a duplicate, without changing the diagram', () => {
    const s = keyboardBuild();
    const bad = reduce(s, { type: 'connect', from: 'board:J7.3', to: 'board:J99.1' });
    expect(bad.diagram).toBe(s.diagram);
    expect(bad.error).toMatch(/Not changed/);
    const dup = reduce(s, { type: 'connect', from: 'board:J7.3', to: `${id(s, 'X min')}:sig` });
    expect(dup.diagram).toBe(s.diagram);
    expect(dup.error).toMatch(/already connected/);
  });

  it('removing a part removes its wires', () => {
    const s = keyboardBuild();
    const r = reduce(s, { type: 'removePart', id: id(s, 'X min') });
    expect(r.diagram.wires.some((w) => w.from.startsWith(id(s, 'X min')))).toBe(false);
  });

  it('an "other" key is written on accept, exactly one key per click', () => {
    const r = reduce(initialState(emptyDiagram(V8.id)), { type: 'accept', setting: { key: 'xvm', value: 1000, keyClass: 'other', why: '', src: '' } });
    expect(r.draft).toEqual({ xvm: 1000 });
    expect(r.pending).toBeNull();
  });

  it.each([
    ['switch type', 'st', 1, 'SWITCH'],
    ['switch mode', 'xsn', 1, 'SWITCH'],
    ['spindle polarity', 'spep', 1, 'POLARITY'],
    ['motor polarity', '1po', 1, 'POLARITY'],
  ])('%s (%s) opens the typed confirmation and writes nothing until the word matches; Cancel writes nothing', (_l, key, value, word) => {
    const s0 = initialState(emptyDiagram(V8.id));
    const opened = reduce(s0, { type: 'accept', setting: { key, value, keyClass: 'switch', why: '', src: '' } });
    expect(opened.draft).toEqual({});
    expect(opened.pending).toEqual({ key, value, word });
    const wrong = reduce(opened, { type: 'confirm', typed: word.toLowerCase() });
    expect(wrong.draft).toEqual({});
    expect(wrong.pending).not.toBeNull();
    const cancelled = reduce(opened, { type: 'cancel' });
    expect(cancelled.draft).toEqual({});
    expect(cancelled.pending).toBeNull();
    const ok = reduce(opened, { type: 'confirm', typed: word });
    expect(ok.draft).toEqual({ [key]: value });
    expect(ok.pending).toBeNull();
  });
});

describe('editor view', () => {
  it('has one Accept per expected setting and no accept-all', () => {
    const s = keyboardBuild();
    const tree = view(s);
    const accepts = all(tree, byAttr('data-accept')).map((e) => e.props['data-accept']);
    expect(accepts).toEqual(expectedSettings(s.diagram, V8, 'tinyg-en').map((e) => e.key));
    expect(all(tree, (e) => e.tag === 'button' && /all/i.test(text(e)))).toEqual([]);
  });

  it('shows the typed confirmation with Cancel focused, and disables other accepts meanwhile', () => {
    const s = reduce(keyboardBuild(), { type: 'accept', setting: { key: 'st', value: 1, keyClass: 'switch', why: '', src: '' } });
    const tree = view(s);
    const dialog = all(tree, byAttr('role', 'dialog'));
    expect(dialog).toHaveLength(1);
    expect(text(dialog[0] as never)).toContain('Type SWITCH');
    expect(all(tree, byAttr('data-action', 'cancel'))[0]?.props['autoFocus']).toBe(true);
    expect(all(tree, byAttr('data-accept')).every((e) => e.props['disabled'] === true)).toBe(true);
  });

  it('shows the W14 watermark notice and blocks the attestation without an E-stop; neither with one', () => {
    const s = keyboardBuild();
    expect(all(view(s), byAttr('data-watermark'))).toEqual([]);
    expect(all(view(s), byAttr('id', 'wiring-attest'))[0]?.props['disabled']).toBe(false);
    const noEstop = reduce(s, { type: 'removePart', id: id(s, 'E-stop') });
    expect(all(view(noEstop), byAttr('data-watermark'))).toHaveLength(1);
    expect(all(view(noEstop), byAttr('id', 'wiring-attest'))[0]?.props['disabled']).toBe(true);
  });

  it('every "Connect to…" and table control has a label (keyboard and screen reader path)', () => {
    const tree = view(keyboardBuild());
    for (const sel of all(tree, (e) => e.tag === 'select')) expect(all(tree, (e) => e.tag === 'label' && e.props['for'] === sel.props['id'])).toHaveLength(1);
    for (const b of all(tree, byAttr('data-action', 'remove-wire'))) expect(String(b.props['aria-label'])).toMatch(/^Remove wire /);
    expect(all(tree, byAttr('data-wire-row'))).toHaveLength(12);
  });
});

describe('export', () => {
  const exportOf = (d: Diagram) => renderString(d, V8, rules(d, V8, 'tinyg-en'), { paper: 'letter' });

  it('passes the Trusted Types export allowlist, with the watermark on and off', () => {
    const s = keyboardBuild();
    const withEstop = exportOf(s.diagram);
    expect(() => brandSvgExport(withEstop)).not.toThrow();
    expect(withEstop).not.toContain('NO E-STOP SHOWN');
    const noEstop = reduce(s, { type: 'removePart', id: id(s, 'E-stop') }).diagram;
    const marked = exportOf(noEstop);
    expect(() => brandSvgExport(marked)).not.toThrow();
    expect(marked).toContain('INCOMPLETE — NO E-STOP SHOWN');
  });

  it('a hostile label still passes the allowlist as literal text', () => {
    const s = run([{ type: 'addPart', kind: 'buffer', label: '<script>alert(1)</script>' }]);
    const out = exportOf(s.diagram);
    expect(() => brandSvgExport(out)).not.toThrow();
    expect(out).toContain('&lt;script&gt;');
  });

  it('offers only boards with connector data, plus the diagram-only Due + gShield', () => {
    expect(WIRING_BOARDS.map((b) => b.id)).toEqual(['tinyg-v8@8', 'arduino-due-gshield@v5']);
  });
});
