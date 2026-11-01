/**
 * The wiring editor (RUN_PLAN §7.3; old P1-12), minimal but complete on the
 * keyboard path:
 * - palette: add a part from the component library;
 * - "Connect to…": pick a pin, then the pin to connect it to (WCAG 2.2 SC
 *   2.5.7 non-drag path); the connection table edits the same model;
 * - live findings from the rules engine, with the W14 watermark notice;
 * - expected settings with one Accept per key and a typed confirmation for
 *   polarity and switch keys (no accept-all);
 * - export (SVG, Letter or A4), the checklist and the "wired per diagram"
 *   attestation, which the E-stop rule and every BLOCK disable.
 *
 * `WiringEditorView` is pure (state in, vnodes out) so it is tested without a
 * browser; `WiringEditor` holds the state and mounts the DOM-renderer SVG.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import {
  COMPONENTS,
  PART_KINDS,
  boardPins,
  checklist,
  expectedSettings,
  exportFlags,
  renderDom,
  rules,
  W14_WATERMARK,
  type Diagram,
  type Dialect,
  type Paper,
  type PartKind,
  type WiringBoard,
} from '@synthetos/wiring';
import { createReducer, initialState, type EditorAction, type EditorState } from './editorState.ts';

export interface FormState {
  readonly kind: PartKind;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly typed: string;
  readonly paper: Paper;
  readonly attested: boolean;
}

export const DEFAULT_FORM: FormState = { kind: 'switch', label: '', from: '', to: '', typed: '', paper: 'letter', attested: false };

export interface ViewProps {
  readonly board: WiringBoard;
  readonly dialect: Dialect;
  readonly state: EditorState;
  readonly dispatch: (a: EditorAction) => void;
  readonly form: FormState;
  readonly setForm: (f: Partial<FormState>) => void;
  readonly canvas: ComponentChild;
  readonly onExport?: ((paper: Paper) => void) | undefined;
  readonly exportStatus?: string | null;
}

const value = (e: Event): string => (e.currentTarget as HTMLInputElement | HTMLSelectElement).value;

export function pinOptions(board: WiringBoard, diagram: Diagram): readonly { readonly value: string; readonly label: string }[] {
  return [
    ...diagram.parts.flatMap((p) => COMPONENTS[p.kind].pins.map((d) => ({ value: `${p.id}:${d.id}`, label: `${p.label || p.id} · ${d.label}` }))),
    ...boardPins(board).map((b) => ({ value: `board:${b.ref}`, label: `Board ${b.ref} · ${b.label}` })),
  ];
}

const labelOf = (board: WiringBoard, diagram: Diagram, ep: string): string => pinOptions(board, diagram).find((o) => o.value === ep)?.label ?? ep;

export function WiringEditorView(p: ViewProps): ComponentChild {
  const { board, dialect, state, dispatch, form, setForm } = p;
  const d = state.diagram;
  const findings = rules(d, board, dialect);
  const flags = exportFlags(findings);
  const settings = expectedSettings(d, board, dialect);
  const options = pinOptions(board, d);
  const select = (id: string, label: string, current: string, onChange: (v: string) => void, opts: readonly { value: string; label: string }[]) =>
    h('label', { for: id }, label, h('select', { id, value: current, onChange: (e: Event) => onChange(value(e)) }, h('option', { value: '' }, 'Choose…'), opts.map((o) => h('option', { value: o.value, key: o.value }, o.label))));

  return h(
    'div',
    { class: 'wiring-editor', 'data-board': board.id },
    state.error === null ? null : h('p', { role: 'alert', class: 'wiring-error', 'data-error': '' }, state.error),

    h(
      'section',
      { 'aria-labelledby': 'wiring-parts-h', class: 'wiring-palette' },
      h('h2', { id: 'wiring-parts-h' }, 'Parts'),
      h(
        'div',
        { class: 'wiring-row' },
        h('label', { for: 'wiring-kind' }, 'Component', h('select', { id: 'wiring-kind', value: form.kind, onChange: (e: Event) => setForm({ kind: value(e) as PartKind }) }, PART_KINDS.map((k) => h('option', { value: k, key: k }, COMPONENTS[k].title)))),
        h('label', { for: 'wiring-label' }, 'Label', h('input', { id: 'wiring-label', type: 'text', maxLength: 64, value: form.label, onInput: (e: Event) => setForm({ label: value(e) }) })),
        h('button', { type: 'button', 'data-action': 'add-part', onClick: () => (dispatch({ type: 'addPart', kind: form.kind, label: form.label }), setForm({ label: '' })) }, 'Add part'),
      ),
      d.parts.length === 0
        ? h('p', null, 'No parts yet.')
        : h(
            'ul',
            { class: 'wiring-parts' },
            d.parts.map((part) =>
              h(
                'li',
                { key: part.id, 'data-part-row': part.id },
                h('strong', null, part.label || part.id),
                ` (${COMPONENTS[part.kind].title}) `,
                COMPONENTS[part.kind].props.map((def) => {
                  const id = `prop-${part.id}-${def.name}`;
                  const current = part.props[def.name];
                  if (def.type === 'boolean')
                    return h('label', { for: id, key: id }, h('input', { id, type: 'checkbox', checked: current === true, onChange: (e: Event) => dispatch({ type: 'setProp', id: part.id, name: def.name, value: (e.currentTarget as HTMLInputElement).checked }) }), ` ${def.label}`);
                  if (def.type === 'enum')
                    return h('label', { for: id, key: id }, `${def.label} `, h('select', { id, value: String(current), onChange: (e: Event) => dispatch({ type: 'setProp', id: part.id, name: def.name, value: value(e) }) }, def.options.map((o) => h('option', { value: o, key: o }, o))));
                  return h('label', { for: id, key: id }, `${def.label} (${def.unit}) `, h('input', { id, type: 'number', min: def.min, max: def.max, step: 'any', value: String(current), onChange: (e: Event) => dispatch({ type: 'setProp', id: part.id, name: def.name, value: Number(value(e)) }) }));
                }),
                h('button', { type: 'button', 'data-action': 'remove-part', 'aria-label': `Remove ${part.label || part.id}`, onClick: () => dispatch({ type: 'removePart', id: part.id }) }, 'Remove'),
              ),
            ),
          ),
    ),

    h(
      'section',
      { 'aria-labelledby': 'wiring-connect-h', class: 'wiring-connect' },
      h('h2', { id: 'wiring-connect-h' }, 'Connect'),
      h(
        'div',
        { class: 'wiring-row' },
        select('wiring-from', 'Pin', form.from, (v) => setForm({ from: v }), options),
        select('wiring-to', 'Connect to…', form.to, (v) => setForm({ to: v }), options.filter((o) => o.value !== form.from)),
        h('button', { type: 'button', 'data-action': 'connect', onClick: () => (dispatch({ type: 'connect', from: form.from, to: form.to }), setForm({ to: '' })) }, 'Connect'),
      ),
      h(
        'table',
        { class: 'wiring-table', 'data-table': 'connections' },
        h('caption', null, 'Connections'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Wire'), h('th', { scope: 'col' }, 'From'), h('th', { scope: 'col' }, 'To'), h('th', { scope: 'col' }, 'Shielded'), h('th', { scope: 'col' }, 'Actions'))),
        h(
          'tbody',
          null,
          d.wires.map((w) =>
            h(
              'tr',
              { key: w.id, 'data-wire-row': w.id },
              h('td', null, w.id),
              h('td', null, labelOf(board, d, w.from)),
              h('td', null, labelOf(board, d, w.to)),
              h('td', null, h('input', { type: 'checkbox', 'aria-label': `Wire ${w.id} shielded`, checked: w.shielded === true, onChange: (e: Event) => dispatch({ type: 'setWire', id: w.id, patch: { shielded: (e.currentTarget as HTMLInputElement).checked } }) })),
              h('td', null, h('button', { type: 'button', 'data-action': 'remove-wire', 'aria-label': `Remove wire ${w.id}`, onClick: () => dispatch({ type: 'removeWire', id: w.id }) }, 'Remove')),
            ),
          ),
        ),
      ),
    ),

    h('section', { 'aria-label': 'Diagram', class: 'wiring-diagram' }, flags.watermark ? h('p', { class: 'wiring-watermark-notice', 'data-watermark': 'w14' }, W14_WATERMARK) : null, p.canvas),

    h(
      'section',
      { 'aria-labelledby': 'wiring-findings-h', class: 'wiring-findings' },
      h('h2', { id: 'wiring-findings-h' }, `Findings (${findings.length})`),
      h(
        'div',
        { role: 'status' },
        h(
          'ul',
          null,
          findings.map((f, i) =>
            h('li', { key: `${f.rule}-${i}`, 'data-finding': f.rule, 'data-severity': f.severity }, h('strong', null, `${f.severity === 'estop' ? 'E-STOP' : f.severity.toUpperCase()} ${f.rule}`), ` ${f.message} `, h('small', null, `Source: ${f.cite}`)),
          ),
        ),
      ),
    ),

    h(
      'section',
      { 'aria-labelledby': 'wiring-settings-h', class: 'wiring-settings' },
      h('h2', { id: 'wiring-settings-h' }, 'Expected settings (advisory)'),
      h('p', null, 'Each key is accepted on its own into the settings draft. Nothing is written to a machine here.'),
      settings.length === 0
        ? h('p', null, 'No expected settings for this board.')
        : h(
            'ul',
            null,
            settings.map((s) =>
              h(
                'li',
                { key: s.key, 'data-setting': s.key },
                h('code', null, `${s.key} = ${s.value}`),
                ` ${s.why} `,
                h('small', null, `Source: ${s.src}`),
                ' ',
                state.draft[s.key] === s.value
                  ? h('span', { 'data-accepted': s.key }, 'In draft')
                  : h('button', { type: 'button', 'data-accept': s.key, disabled: state.pending !== null, onClick: () => dispatch({ type: 'accept', setting: s }) }, `Accept ${s.key}`),
              ),
            ),
          ),
      state.pending === null
        ? null
        : h(
            'div',
            { role: 'dialog', 'aria-labelledby': 'wiring-confirm-h', class: 'wiring-confirm', 'data-confirm': state.pending.key },
            h('h3', { id: 'wiring-confirm-h' }, `Confirm ${state.pending.key} = ${state.pending.value}`),
            h('p', null, `This changes ${state.pending.word === 'POLARITY' ? 'which level turns an output or input on' : 'how the switches are read'}. Type ${state.pending.word} to write it to the draft.`),
            h('label', { for: 'wiring-confirm-input' }, 'Confirmation', h('input', { id: 'wiring-confirm-input', type: 'text', autocomplete: 'off', value: form.typed, onInput: (e: Event) => setForm({ typed: value(e) }) })),
            h('button', { type: 'button', 'data-action': 'cancel', autoFocus: true, onClick: () => (dispatch({ type: 'cancel' }), setForm({ typed: '' })) }, 'Cancel'),
            h('button', { type: 'button', 'data-action': 'confirm', onClick: () => (dispatch({ type: 'confirm', typed: form.typed }), setForm({ typed: '' })) }, 'Confirm'),
          ),
      h('p', { 'data-draft': '' }, 'Settings draft: ', Object.keys(state.draft).length === 0 ? 'empty' : Object.entries(state.draft).map(([k, v]) => `${k}=${v}`).join(', ')),
    ),

    h(
      'section',
      { 'aria-labelledby': 'wiring-export-h', class: 'wiring-export' },
      h('h2', { id: 'wiring-export-h' }, 'Export and checklist'),
      h(
        'div',
        { class: 'wiring-row' },
        h('label', { for: 'wiring-paper' }, 'Paper', h('select', { id: 'wiring-paper', value: form.paper, onChange: (e: Event) => setForm({ paper: value(e) as Paper }) }, h('option', { value: 'letter' }, 'Letter'), h('option', { value: 'a4' }, 'A4'))),
        h('button', { type: 'button', 'data-action': 'export', disabled: p.onExport === undefined, onClick: () => p.onExport?.(form.paper) }, 'Export SVG'),
      ),
      p.exportStatus === null || p.exportStatus === undefined ? null : h('p', { role: 'status', 'data-export-status': '' }, p.exportStatus),
      h('ol', { class: 'wiring-checklist' }, checklist(d, board).map((c) => h('li', { key: c.id, 'data-check': c.id }, c.text, ' ', h('small', null, `Source: ${c.src}`)))),
      h(
        'label',
        { for: 'wiring-attest' },
        h('input', { id: 'wiring-attest', type: 'checkbox', disabled: flags.attestationBlocked, checked: form.attested && !flags.attestationBlocked, onChange: (e: Event) => setForm({ attested: (e.currentTarget as HTMLInputElement).checked }) }),
        ' My machine is wired per this diagram',
      ),
      flags.attestationBlocked ? h('p', { 'data-attest-blocked': '' }, flags.watermark ? 'Not available: no E-stop that removes motor and spindle power is shown.' : `Not available: ${flags.blocking} blocking finding(s).`) : null,
    ),
  );
}

export interface WiringEditorProps {
  readonly board: WiringBoard;
  readonly dialect: Dialect;
  readonly initial: Diagram;
  /** Turns the export string into a download; absent while prerendering. */
  readonly onExport?: ((diagram: Diagram, board: WiringBoard, dialect: Dialect, paper: Paper) => string) | undefined;
}

export function WiringEditor(props: WiringEditorProps): ComponentChild {
  const reducer = useMemo(() => createReducer(props.board), [props.board]);
  const [state, dispatch] = useReducer(reducer, props.initial, initialState);
  const [form, setFormState] = useState<FormState>(DEFAULT_FORM);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (el === null) return;
    el.replaceChildren(renderDom(document, state.diagram, props.board, rules(state.diagram, props.board, props.dialect)) as unknown as SVGSVGElement);
  }, [state.diagram, props.board, props.dialect]);
  // Dialogs focus Cancel (SAFETY keyboard policy); autofocus does not apply to an element inserted after load.
  const pendingKey = state.pending?.key;
  useEffect(() => {
    if (pendingKey !== undefined) canvas.current?.ownerDocument.querySelector<HTMLButtonElement>('[data-confirm] [data-action="cancel"]')?.focus();
  }, [pendingKey]);
  const onExport = props.onExport;
  return h(WiringEditorView, {
    board: props.board,
    dialect: props.dialect,
    state,
    dispatch,
    form,
    setForm: (f: Partial<FormState>) => setFormState((old) => ({ ...old, ...f })),
    canvas: h('div', { ref: canvas, class: 'wiring-canvas' }),
    onExport: onExport === undefined ? undefined : (paper: Paper) => setExportStatus(onExport(state.diagram, props.board, props.dialect, paper)),
    exportStatus,
  });
}
