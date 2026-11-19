/**
 * One control for every setting (Board settings spec §5.1, OD-44): the
 * allowed values by meaning, the board value selected, and a change becomes a
 * pending change in this browser (`setDraft`) with "was …" beside it. Choosing
 * the board value again removes the pending change. Nothing here writes to
 * the board: only Review and apply does, through live/settingsApply.ts.
 *
 * - segmented: an enumeration of at most five values whose words fit;
 * - select: a longer enumeration;
 * - number: a field sized to its content, the unit beside it, the range on hover;
 * - locked: every option shown, the current one marked, nothing enabled
 *   (a read-only board, a blocked edit, or a length while the board is in inches);
 * - text: the value in words (read, forbidden, reserved, readout, or no definition).
 *
 * Hook-free on purpose: the number field is uncontrolled and keyed by its
 * value, so a live snapshot never erases a number while it is typed.
 */
import { h, type ComponentChild } from 'preact';
import type { SettingValue, ValueDef } from '@synthetos/schema';
import { draftStore, setDraft } from '../boardFacts.ts';
import type { LiveView } from '../model.ts';
import { boardBuild } from './defs.ts';
import { editBlocked } from './editGate.ts';
import { boardInches, settingMeta, type SettingMeta } from './meta.ts';
import { writableKey } from './pending.ts';
import { numberWords, unitWords } from './units.ts';

export type ControlKind = 'segmented' | 'select' | 'number' | 'locked' | 'text';

interface Ctx {
  readonly k: string;
  readonly meta: SettingMeta;
  readonly board: SettingValue | undefined;
  readonly current: number | undefined;
  /** Lengths read in inches: labelled so, never edited (writes are millimetres only, H60). */
  readonly inches: boolean;
}

const SEGMENT_MAX = 5;
const SEGMENT_CHARS = 48;

function fitsSegments(values: readonly ValueDef[]): boolean {
  return values.length <= SEGMENT_MAX && values.reduce((n, v) => n + v.label.length, 0) <= SEGMENT_CHARS;
}

export function controlKind(meta: SettingMeta, editable: boolean, inches: boolean): ControlKind {
  if (editable) return meta.values === null ? 'number' : fitsSegments(meta.values) ? 'segmented' : 'select';
  if (inches || meta.access === 'write') return 'locked';
  return meta.values !== null && meta.access === 'read' ? 'locked' : 'text';
}

function pick(c: Ctx, v: number | null): void {
  const same = v !== null && typeof c.board === 'number' && Math.abs(c.board - v) < 1e-9;
  setDraft(c.k, v === null || same ? null : v);
}

/** A value in words, lengths in inches when the board reports inches. */
function words(c: Ctx, v: SettingValue | undefined): string {
  if (v === undefined) return 'Not read';
  if (typeof v !== 'number') return v;
  const d = c.meta.def;
  if (d?.values !== undefined) return d.values.find((e) => e.value === v)?.label ?? `Unknown value (${numberWords(v)})`;
  const n = numberWords(v, d?.display);
  const unit = unitWords(d?.unit, c.inches);
  if (unit === '') return n;
  return unit.startsWith('°') && !unit.startsWith('°/') ? `${n}${unit}` : `${n} ${unit}`;
}

const known = (c: Ctx): boolean => c.current !== undefined && (c.meta.values ?? []).some((v) => v.value === c.current);

function unknownNote(c: Ctx): ComponentChild {
  return c.current === undefined || known(c) ? null : h('span', { class: 'setting-unknown' }, `Unknown value (${numberWords(c.current)})`);
}

function Segmented({ c }: { readonly c: Ctx }): ComponentChild {
  return h(
    'span',
    { class: 'segmented', role: 'radiogroup', 'aria-label': c.meta.label },
    (c.meta.values ?? []).map((v) =>
      h('button', { key: v.value, type: 'button', role: 'radio', class: 'segment', 'data-value': String(v.value), 'aria-checked': c.current === v.value ? 'true' : 'false', title: v.help, onClick: () => pick(c, v.value) }, v.label),
    ),
    unknownNote(c),
  );
}

function Select({ c }: { readonly c: Ctx }): ComponentChild {
  const isKnown = known(c);
  return h(
    'span',
    { class: 'select-wrap' },
    h(
      'select',
      { 'aria-label': c.meta.label, title: c.meta.description, value: isKnown ? String(c.current) : '', onChange: (e: Event) => pick(c, Number((e.currentTarget as HTMLSelectElement).value)) },
      isKnown ? null : h('option', { value: '', disabled: true, selected: true }, c.current === undefined ? 'Not read' : `Unknown value (${numberWords(c.current)})`),
      (c.meta.values ?? []).map((v) => h('option', { key: v.value, value: String(v.value), title: v.help }, v.label)),
    ),
  );
}

function rangeWords(c: Ctx): string {
  const r = c.meta.def?.write?.range;
  if (r === undefined) return c.meta.description;
  const unit = unitWords(c.meta.def?.unit);
  const tail = unit === '' ? '' : ` ${unit}`;
  return r.minExclusive === true ? `Greater than ${numberWords(r.min)} and at most ${numberWords(r.max)}${tail}` : `${numberWords(r.min)} to ${numberWords(r.max)}${tail}`;
}

function NumberField({ c }: { readonly c: Ctx }): ComponentChild {
  const r = c.meta.def?.write?.range;
  const shown = c.current === undefined ? '' : String(c.current);
  const unit = unitWords(c.meta.def?.unit, c.inches);
  return h(
    'span',
    { class: 'unit-input' },
    h('input', {
      key: `${c.k}:${shown}`,
      type: 'number',
      step: 'any',
      inputMode: 'decimal',
      'aria-label': c.meta.label,
      min: r?.min,
      max: r?.max,
      defaultValue: shown,
      title: rangeWords(c),
      style: `width: calc(${Math.max(4, shown.length + 1)}ch + 18px)`,
      onChange: (e: Event) => {
        const raw = (e.currentTarget as HTMLInputElement).value.trim();
        const n = Number(raw);
        pick(c, raw === '' || !Number.isFinite(n) ? null : n);
      },
    }),
    unit === '' ? null : h('i', null, unit),
  );
}

function Locked({ c }: { readonly c: Ctx }): ComponentChild {
  if (c.meta.values === null || c.inches) return h('span', { class: 'setting-value' }, words(c, c.board));
  return h(
    'span',
    { class: fitsSegments(c.meta.values) ? 'segmented locked' : 'option-list locked', role: 'list', 'aria-label': c.meta.label },
    c.meta.values.map((v) => h('span', { key: v.value, role: 'listitem', class: 'segment', 'data-value': String(v.value), 'aria-current': c.current === v.value ? 'true' : undefined, title: v.help }, v.label)),
    unknownNote(c),
  );
}

function body(kind: ControlKind, c: Ctx): ComponentChild {
  switch (kind) {
    case 'segmented': return h(Segmented, { c });
    case 'select': return h(Select, { c });
    case 'number': return h(NumberField, { c });
    case 'locked': return h(Locked, { c });
    default: return h('span', { class: 'setting-value' }, words(c, c.board));
  }
}

function contextOf(k: string, view: LiveView | null, draft: number | undefined): Ctx {
  const meta = settingMeta(k, view?.readout.dialectId ?? null, boardBuild(view));
  const board = view?.readout.settings[k];
  const current = draft ?? (typeof board === 'number' ? board : undefined);
  const inches = boardInches(view) && meta.def?.convert === true;
  return { k, meta, board, current, inches };
}

/** One setting's control. `locked` forces the locked rendering (a tab that never edits it). */
export function SettingControl({ k, view, locked = false }: { readonly k: string; readonly view: LiveView | null; readonly locked?: boolean }): ComponentChild {
  const draft = draftStore.value.value[k];
  const c = contextOf(k, view, draft);
  const editable = !locked && !c.inches && writableKey(k, view?.readout.dialectId ?? null) && editBlocked(view) === null;
  const kind = controlKind(c.meta, editable, c.inches);
  const board = c.board;
  return h(
    'span',
    { class: `setting-control kind-${kind}${draft === undefined ? '' : ' pending'}`, 'data-setting-control': k, 'data-control-kind': kind, 'data-pending': draft === undefined ? undefined : 'true' },
    body(kind, c),
    draft === undefined ? null : h('span', { class: 'was', 'data-was': '' }, `was ${words(c, board)}`),
  );
}
