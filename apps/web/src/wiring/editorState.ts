/**
 * Wiring editor state (RUN_PLAN §7.3; old P1-12): a pure reducer, so every
 * editing path (the "Connect to…" controls, the connection table) changes the
 * same model, and the expected-settings rules are testable without a browser.
 *
 * - Every change is re-validated with `parseDiagram`; an invalid change is
 *   refused with a message and the diagram stays as it was.
 * - Expected settings are advisory: `accept` writes exactly one key into the
 *   settings draft. A polarity or switch key does not write; it opens a typed
 *   confirmation, and only the exact word writes it. Cancel writes nothing.
 *   There is no accept-all action.
 */
import {
  COMPONENTS,
  confirmWord,
  defaultProps,
  parseDiagram,
  keyClass,
  type Diagram,
  type ExpectedSetting,
  type PartKind,
  type PropValue,
  type Wire,
  type WiringBoard,
} from '@synthetos/wiring';

export interface PendingConfirmation {
  readonly key: string;
  readonly value: number;
  readonly word: string;
}

export interface EditorState {
  readonly diagram: Diagram;
  /** The settings draft the accepted keys go to (the profile's draft once profiles are stored). */
  readonly draft: Readonly<Record<string, number>>;
  readonly pending: PendingConfirmation | null;
  readonly error: string | null;
  readonly nextId: number;
}

export type EditorAction =
  | { readonly type: 'addPart'; readonly kind: PartKind; readonly label: string }
  | { readonly type: 'removePart'; readonly id: string }
  | { readonly type: 'setProp'; readonly id: string; readonly name: string; readonly value: PropValue }
  | { readonly type: 'connect'; readonly from: string; readonly to: string }
  | { readonly type: 'removeWire'; readonly id: string }
  | { readonly type: 'setWire'; readonly id: string; readonly patch: Pick<Wire, 'shielded'> }
  | { readonly type: 'accept'; readonly setting: ExpectedSetting }
  | { readonly type: 'confirm'; readonly typed: string }
  | { readonly type: 'cancel' };

export function initialState(diagram: Diagram): EditorState {
  return { diagram, draft: {}, pending: null, error: null, nextId: diagram.parts.length + diagram.wires.length + 1 };
}

export function createReducer(board: WiringBoard): (s: EditorState, a: EditorAction) => EditorState {
  const commit = (s: EditorState, candidate: Diagram): EditorState => {
    const parsed = parseDiagram(JSON.parse(JSON.stringify(candidate)), board);
    if (!parsed.ok) return { ...s, error: `Not changed: ${parsed.errors[0] ?? 'invalid diagram'}` };
    return { ...s, diagram: parsed.diagram, error: null, nextId: s.nextId + 1 };
  };
  return (s, a) => {
    const d = s.diagram;
    switch (a.type) {
      case 'addPart': {
        const id = `${a.kind.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12)}-${s.nextId}`;
        return commit(s, { ...d, parts: [...d.parts, { id, kind: a.kind, label: a.label.trim().slice(0, 64) || `${COMPONENTS[a.kind].title} ${s.nextId}`, props: defaultProps(a.kind) }] });
      }
      case 'removePart':
        return commit(s, { ...d, parts: d.parts.filter((p) => p.id !== a.id), wires: d.wires.filter((w) => !w.from.startsWith(`${a.id}:`) && !w.to.startsWith(`${a.id}:`)) });
      case 'setProp':
        return commit(s, { ...d, parts: d.parts.map((p) => (p.id === a.id ? { ...p, props: { ...p.props, [a.name]: a.value } } : p)) });
      case 'connect': {
        if (a.from === '' || a.to === '') return { ...s, error: 'Choose both pins first.' };
        if (d.wires.some((w) => (w.from === a.from && w.to === a.to) || (w.from === a.to && w.to === a.from))) return { ...s, error: 'Those pins are already connected.' };
        return commit(s, { ...d, wires: [...d.wires, { id: `w${s.nextId}`, from: a.from, to: a.to }] });
      }
      case 'removeWire':
        return commit(s, { ...d, wires: d.wires.filter((w) => w.id !== a.id) });
      case 'setWire':
        return commit(s, { ...d, wires: d.wires.map((w) => (w.id === a.id ? { ...w, ...a.patch } : w)) });
      case 'accept': {
        const word = confirmWord(keyClass(a.setting.key));
        if (word === undefined) return { ...s, draft: { ...s.draft, [a.setting.key]: a.setting.value }, pending: null, error: null };
        return { ...s, pending: { key: a.setting.key, value: a.setting.value, word }, error: null };
      }
      case 'confirm': {
        if (s.pending === null) return s;
        if (a.typed !== s.pending.word) return { ...s, error: `Type ${s.pending.word} exactly to write ${s.pending.key}.` };
        return { ...s, draft: { ...s.draft, [s.pending.key]: s.pending.value }, pending: null, error: null };
      }
      case 'cancel':
        return { ...s, pending: null, error: null };
    }
  };
}
