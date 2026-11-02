/**
 * The Console tab's command line (WORKSPACE_FEATURES "Console command
 * line"): type a line, see what it becomes on the wire, and, for a read, the
 * board's answer in plain words with the raw JSON one click away. ↑/↓ walk
 * the history; as you type a setting name, matching tokens are offered with
 * their plain-words description (Tab takes the highlighted one).
 *
 * Phase 1 sends reads only, through the worker's read path and allowlist
 * (live/consoleRead.ts). Motion and settings writes are translated and shown,
 * and nothing is sent. The realtime characters are refused: Pause and Stop
 * job are buttons. Escape is never handled here, so it still pauses.
 */
import { h, type ComponentChild } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import type { ConsoleAnswer } from '../live/consoleRead.ts';
import { jobStreaming } from '../live/consoleRead.ts';
import { openReport } from '../report/state.ts';
import { Icon } from '../workspace/icons.ts';
import { connected, type WorkspaceModel } from '../workspace/model.ts';
import { translate, type Translation } from './translate.ts';
import { allowedRead, complete, replyRows, statusText, suggest } from './words.ts';

/** Most lines kept in the history and on screen. */
export const HISTORY_MAX = 50;

interface Entry {
  readonly id: number;
  readonly input: string;
  readonly translation: Translation;
  readonly answer: ConsoleAnswer | 'waiting' | null;
}

function Outcome({ entry, dialect }: { readonly entry: Entry; readonly dialect: string | null }): ComponentChild {
  const t = entry.translation;
  if (t.kind === 'read') {
    const a = entry.answer;
    if (a === 'waiting' || a === null) return h('p', { class: 'cl-wait', role: 'status' }, 'Asking the board…');
    if (!a.ok) return h('p', { class: 'cl-msg tone-warn', 'data-console-reply': 'failed' }, a.message);
    const rows = replyRows(t.token, a.value, dialect);
    return h(
      'div',
      { class: 'cl-reply', 'data-console-reply': 'answered' },
      a.status === 0 ? null : h('p', { class: 'cl-msg tone-warn' }, `The board answered with ${statusText(a.status)}.`),
      h(
        'dl',
        { class: 'cl-rows' },
        rows.slice(0, 40).map((r) => h('div', { key: r.key, 'data-console-key': r.key }, h('dt', null, r.label === '' ? h('code', null, r.key) : [r.label, ' ', h('code', { key: 'k' }, r.key)]), h('dd', null, r.value))),
      ),
      rows.length > 40 ? h('p', { class: 'fine' }, `and ${rows.length - 40} more in the raw answer`) : null,
      h('details', { class: 'cl-raw' }, h('summary', null, 'Raw JSON'), h('pre', { 'data-console-raw': '' }, a.raw ?? JSON.stringify({ r: { [t.token]: a.value } }))),
    );
  }
  if (t.kind === 'motion' || t.kind === 'write') return h('p', { class: 'cl-msg tone-info', 'data-console-reply': t.kind }, `${t.reason}. Nothing was sent.`);
  if (t.kind === 'refused') return h('p', { class: 'cl-msg tone-warn', 'data-console-reply': 'refused' }, t.reason);
  return null;
}

export function ConsoleLine({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  const snapshot = view?.message?.snapshot ?? null;
  const isConnected = view !== null && connected(view);
  const dialect = isConnected ? (snapshot?.classification?.dialectId ?? null) : null;
  const [text, setText] = useState('');
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [history, setHistory] = useState<readonly string[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [pick, setPick] = useState(0);
  const [recalled, setRecalled] = useState(false);
  const nextId = useRef(1);
  const log = useRef<HTMLOListElement>(null);
  const suggestions = useMemo(() => (recalled ? [] : suggest(text, dialect)), [text, dialect, recalled]);
  const highlighted = suggestions[Math.min(pick, suggestions.length - 1)] ?? null;

  const scrollDown = (): void => {
    requestAnimationFrame(() => {
      const el = log.current;
      if (el !== null) el.scrollTop = el.scrollHeight;
    });
  };

  const submit = (): void => {
    const line = text.trim();
    if (line === '') return;
    const translation = translate(line, {
      readDecision: isConnected && dialect !== null ? allowedRead(dialect) : null,
      jobStreaming: jobStreaming(snapshot),
    });
    const id = nextId.current++;
    const entry: Entry = { id, input: line, translation, answer: translation.kind === 'read' ? 'waiting' : null };
    setEntries((now) => [...now, entry].slice(-HISTORY_MAX));
    setHistory((now) => [...now.filter((x) => x !== line), line].slice(-HISTORY_MAX));
    setText('');
    setAt(null);
    setRecalled(false);
    scrollDown();
    if (translation.kind !== 'read') return;
    const actions = model?.actions.value ?? null;
    const done = (answer: ConsoleAnswer): void => {
      setEntries((now) => now.map((e) => (e.id === id ? { ...e, answer } : e)));
      scrollDown();
    };
    if (actions === null) done({ ok: false, message: 'The machine worker is not running in this browser.' });
    else void actions.consoleRead(translation.token).then(done, (e: unknown) => done({ ok: false, message: e instanceof Error ? e.message : String(e) }));
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Tab' && highlighted !== null && !e.shiftKey) {
      e.preventDefault();
      setText(complete(text, highlighted.token));
      setPick(0);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const up = e.key === 'ArrowUp';
      if (suggestions.length > 1) {
        e.preventDefault();
        setPick((p) => (up ? (p - 1 + suggestions.length) % suggestions.length : (p + 1) % suggestions.length));
        return;
      }
      if (history.length === 0) return;
      e.preventDefault();
      const next = at === null ? (up ? history.length - 1 : null) : up ? Math.max(0, at - 1) : at + 1 >= history.length ? null : at + 1;
      setAt(next);
      setRecalled(next !== null);
      setText(next === null ? '' : (history[next] as string));
    }
  };

  const preview = text.trim() === '' ? null : translate(text, { readDecision: isConnected && dialect !== null ? allowedRead(dialect) : null, jobStreaming: jobStreaming(snapshot) });
  const wire = preview === null || preview.kind === 'empty' ? null : 'wire' in preview ? preview.wire : null;

  return h(
    'div',
    { class: 'cl', 'data-region': 'console-line' },
    h(
      'div',
      { class: 'cl-head' },
      h('span', { class: 'cl-title' }, Icon('terminal', 15), 'Command line'),
      h('span', { class: 'cl-phase' }, 'Reads only in this release'),
      h('button', { type: 'button', class: 'small quiet-link', 'data-action': 'report-console', onClick: () => openReport({ origin: 'console' }) }, Icon('flag', 13), 'Report from here'),
    ),
    entries.length === 0
      ? h('p', { class: 'cl-empty' }, 'Type ', h('code', null, '?'), ' for a status report, or a setting name such as ', h('code', null, '$xvm'), '. Lines become JSON, so the board stays in JSON mode.')
      : h(
          'ol',
          { class: 'cl-log', ref: log, 'aria-label': 'Commands and answers', 'aria-live': 'polite' },
          entries.map((entry) =>
            h(
              'li',
              { key: String(entry.id), class: `cl-entry kind-${entry.translation.kind}`, 'data-console-entry': entry.translation.kind },
              h('div', { class: 'cl-sent' }, h('code', { class: 'cl-typed' }, entry.input), 'wire' in entry.translation && entry.translation.wire !== undefined ? h('code', { class: 'cl-wire', title: entry.translation.kind === 'read' ? 'Sent to the board' : 'Not sent' }, entry.translation.wire) : null),
              h(Outcome, { entry, dialect }),
            ),
          ),
        ),
    suggestions.length === 0
      ? null
      : h(
          'ul',
          { class: 'cl-suggest', id: 'cl-suggest', role: 'listbox', 'aria-label': 'Matching settings' },
          suggestions.map((s, i) =>
            h(
              'li',
              {
                key: s.token,
                id: `cl-opt-${s.token}`,
                role: 'option',
                'aria-selected': s === highlighted ? 'true' : 'false',
                onMouseDown: (e: MouseEvent) => {
                  e.preventDefault();
                  setText(complete(text, s.token));
                  setPick(0);
                },
                onMouseEnter: () => setPick(i),
              },
              h('code', null, s.token),
              h('span', null, s.label === '' ? 'No plain-words name yet' : s.label),
            ),
          ),
        ),
    h(
      'form',
      {
        class: 'cl-form',
        onSubmit: (e: Event) => {
          e.preventDefault();
          submit();
        },
      },
      h('label', { class: 'sr-only', for: 'console-input' }, 'Command: G-code, a setting name, ? or JSON'),
      h('span', { class: 'cl-prompt', 'aria-hidden': 'true' }, '›'),
      h('input', {
        id: 'console-input',
        type: 'text',
        autoComplete: 'off',
        spellcheck: false,
        role: 'combobox',
        'aria-expanded': suggestions.length > 0 ? 'true' : 'false',
        ...(suggestions.length > 0 ? { 'aria-controls': 'cl-suggest' } : {}),
        'aria-autocomplete': 'list',
        ...(highlighted === null ? {} : { 'aria-activedescendant': `cl-opt-${highlighted.token}` }),
        placeholder: isConnected ? '?  $xvm  g0x10  {"sr":null}' : 'Connect a board to read from it',
        value: text,
        maxLength: 254,
        'data-console': 'input',
        onInput: (e: Event) => {
          setText((e.currentTarget as HTMLInputElement).value);
          setPick(0);
          setRecalled(false);
          setAt(null);
        },
        onKeyDown: onKey,
      }),
      wire === null ? null : h('code', { class: `cl-preview kind-${preview?.kind ?? ''}`, 'data-console': 'preview' }, wire),
      h('button', { type: 'submit', class: 'small', disabled: !isConnected, 'data-machine-control': 'read', 'data-action': 'console-send', title: isConnected ? 'Send a read; motion and writes are shown, never sent' : 'Connect a board first' }, 'Send'),
    ),
    h('p', { class: 'cl-hint', 'data-console': 'hint' }, highlighted !== null ? [h('code', { key: 'c' }, highlighted.token), ` ${highlighted.label === '' ? '' : `${highlighted.label}. `}${highlighted.description === '' ? '' : highlighted.description}`, h('span', { key: 'k', class: 'cl-keys' }, ' Tab to complete')] : '↑ ↓ history · Tab completes · ! ~ % and Ctrl-X are never typed here: use Pause and Stop job.'),
  );
}
