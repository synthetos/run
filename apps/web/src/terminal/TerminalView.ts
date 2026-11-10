/**
 * The terminal (H91, OD-31; docs/design/terminal-typed-moves.md): type a line, and it takes the same path as the
 * button that does the same thing. There is no second path to the board.
 *
 * - reads go through the worker's read path (live/consoleRead.ts);
 * - a G0..G4 line is the session's `typedMove`, decided again there; the session's answer comes back as its typed
 *   notice: done, refused, the travel question, or "Z is low. Raise Z first?";
 * - spindle, coolant, zero, offset and home lines are the buttons' commands, after the buttons' confirmations;
 * - `!`, `~`, `%` and Ctrl-X press the page's real Pause, Resume and Stop job;
 * - more than one line pasted offers "Open as a job".
 *
 * Escape is never handled here, so it still pauses. Typing only fills the line: nothing is sent before Enter.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { parseTypedLine } from '@synthetos/safety';
import type { MotionCommand } from '../machine-worker/rpc.ts';
import { openReport } from '../report/state.ts';
import { openJob } from '../workspace/fileBridge.ts';
import { Icon } from '../workspace/icons.ts';
import { connected, type WorkspaceModel } from '../workspace/model.ts';
import { resumeAction } from '../workspace/resumeAction.ts';
import { spindleConfirmSkipped } from '../workspace/spindleConfirm.ts';
import type { StopHooks } from '../workspace/views/JobStatusCard.ts';
import { applyCompletion, commonPrefix, completions, type Completion } from './complete.ts';
import { FIRST_MOVE_NOTICE, KIND_CLASS, SYMBOL, typedResult, type TypedMoveNotice } from './format.ts';
import { History } from './history.ts';
import { asProgram } from './paste.ts';
import { modesLine, movePreview } from './preview.ts';
import { TerminalAsk, type Ask, type AskResult } from './TerminalAsk.ts';
import { boardModes, machineKey, readEntry, terminalContext, typedOutcome, typedRunning } from './terminalSession.ts';
import { classify, type TerminalCommand } from './translate.ts';
import { DEFAULT_FILTER, EMPTY_TRANSCRIPT, append, timeOf, visible, type Entry, type TranscriptFilter } from './transcript.ts';

/** The first-move notice is shown once per page load (design doc, "Notice"). */
let firstMoveNoticeShown = false;

/** Tests only: show the first-move notice again. */
export function resetFirstMoveNotice(): void {
  firstMoveNoticeShown = false;
}

interface Waiting {
  readonly line: string;
  readonly before: TypedMoveNotice | null;
  readonly travel: string | null;
  readonly lowZ: 'raise' | 'asTyped' | null;
}

// Errors carry ✕; notes carry their own symbol (✓ ⚠ ⏸); a sent line gets the prompt from the stylesheet.
const SYMBOL_OF: Readonly<Record<Entry['kind'], string>> = { sent: '', reply: '', error: SYMBOL.error, status: '', note: '' };

/** `text` with each `quoted` part as code (typo help names what was typed and what was meant that way). */
function withCode(text: string): ComponentChild[] {
  return text.split('`').map((part, i) => (i % 2 === 1 ? h('code', { key: String(i) }, part) : part));
}

function EntryRow({ entry }: { readonly entry: Entry }): ComponentChild {
  const symbol = /^[✓⚠✕⏸▶]/.test(entry.text) ? '' : SYMBOL_OF[entry.kind];
  return h(
    'li',
    { class: `term-entry ${KIND_CLASS[entry.kind]}`, 'data-terminal-entry': entry.kind },
    h('time', null, timeOf(entry.at)),
    h('span', { class: 'term-text' }, symbol === '' ? null : h('span', { class: 'term-sym', 'aria-hidden': 'true' }, `${symbol} `), withCode(entry.text)),
  );
}

export function TerminalView({ model, stops, advanced }: { readonly model: WorkspaceModel | null; readonly stops: StopHooks; readonly advanced: boolean }): ComponentChild {
  const view = model?.live.value ?? null;
  const snapshot = view?.message?.snapshot ?? null;
  const isConnected = view !== null && connected(view);
  const ctx = terminalContext(isConnected ? snapshot : null);
  const key = machineKey(snapshot);
  const history = useMemo(() => new History(key), [key]);
  const [transcript, setTranscript] = useState(EMPTY_TRANSCRIPT);
  const [filter, setFilter] = useState<TranscriptFilter>(DEFAULT_FILTER);
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<readonly Completion[]>([]);
  const [pick, setPick] = useState(0);
  const [search, setSearch] = useState<{ readonly query: string; readonly index: number | null } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [paste, setPaste] = useState<readonly string[] | null>(null);
  const log = useRef<HTMLOListElement>(null);
  const lastMotionNotice = useRef<number | null>(null);

  const add = (entry: Omit<Entry, 'id'>): void => {
    setTranscript((t) => append(t, entry));
    requestAnimationFrame(() => {
      const el = log.current;
      if (el !== null) el.scrollTop = el.scrollHeight;
    });
  };
  const note = (kind: Entry['kind'], text: string): void => add({ at: Date.now(), kind, text });

  // The session's word on a typed move: done, refused, stopped, or a question to ask.
  useEffect(() => {
    if (waiting === null) return;
    const outcome = typedOutcome(snapshot, waiting.line, waiting.before);
    if (outcome === null) return;
    setWaiting(null);
    const shown = typedResult(outcome);
    note(outcome.kind === 'done' ? 'note' : outcome.kind === 'confirm' || outcome.kind === 'lowZ' ? 'note' : 'error', `${shown.symbol} ${shown.text}`);
    if (outcome.kind === 'confirm' && outcome.travel !== undefined) setAsk({ kind: 'travel', line: waiting.line, finding: outcome.travel, lowZ: waiting.lowZ });
    if (outcome.kind === 'lowZ') setAsk({ kind: 'lowZ', line: waiting.line, notice: outcome, travel: waiting.travel });
  }, [snapshot, waiting]);

  // Pause, Resume and Stop results, as status lines (hidden by the status filter).
  const motionNotice = snapshot?.notices.motion;
  useEffect(() => {
    if (motionNotice === undefined || motionNotice.at === lastMotionNotice.current) return;
    const first = lastMotionNotice.current === null;
    lastMotionNotice.current = motionNotice.at;
    if (!first) note('status', `${motionNotice.kind === 'paused' ? `${SYMBOL.paused} ` : ''}${motionNotice.text}`);
  }, [motionNotice?.at]);

  const send = async (command: MotionCommand, line: string): Promise<void> => {
    const motion = model?.actions.value?.motion;
    if (motion === undefined) {
      note('error', 'The machine worker is not running in this browser.');
      return;
    }
    const refusal = await motion(command);
    note(refusal === null ? 'note' : 'error', refusal === null ? `${SYMBOL.done} ${line}: sent.` : refusal);
  };

  const sendMove = async (line: string, travel: string | null, lowZ: 'raise' | 'asTyped' | null): Promise<void> => {
    const motion = model?.actions.value?.motion;
    if (motion === undefined || !isConnected) {
      note('error', isConnected ? 'The machine worker is not running in this browser.' : 'No board is connected. Connect first.');
      return;
    }
    if (!firstMoveNoticeShown) {
      firstMoveNoticeShown = true;
      note('note', `${SYMBOL.warn} ${FIRST_MOVE_NOTICE}`);
    }
    setWaiting({ line, before: snapshot?.notices.typed ?? null, travel, lowZ });
    const refusal = await motion({ op: 'typedMove', line, travel, lowZ });
    if (refusal !== null) {
      setWaiting(null);
      note('error', refusal);
    }
  };

  const read = async (token: string): Promise<void> => {
    const actions = model?.actions.value ?? null;
    if (actions === null) {
      note('error', 'The machine worker is not running in this browser.');
      return;
    }
    const answer = await actions.consoleRead(token).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
    add(readEntry(token, answer, ctx.dialect, Date.now()));
  };

  const realtime = (action: 'pause' | 'resume' | 'stop'): void => {
    if (action === 'pause') {
      if (stops.onPause === undefined) note('error', 'Pause is the button at the top right, or Escape.');
      else stops.onPause();
      return;
    }
    if (action === 'stop') {
      if (stops.onStopJob === undefined) note('error', 'Stop job is the red button at the top right.');
      else stops.onStopJob();
      return;
    }
    const resume = resumeAction(model);
    if (resume === null) note('error', 'Nothing is paused that Resume can continue.');
    else resume();
  };

  const run = (command: TerminalCommand): void => {
    switch (command.kind) {
      case 'empty':
        return;
      case 'read':
        void read(command.token);
        return;
      case 'move':
        void sendMove(command.line, null, null);
        return;
      case 'realtime':
        realtime(command.action);
        return;
      case 'paste':
        setPaste(command.lines);
        note('note', `Pasted ${command.lines.length} lines. The terminal runs one line at a time.`);
        return;
      case 'refused':
        note('error', command.remedy === '' ? command.reason : `${command.reason} ${command.remedy}`);
        return;
      default: {
        // A button's command: its confirmation first, as the button asks (none for coolant and the offs).
        const skipC24 = command.confirm === 'C24' && spindleConfirmSkipped();
        if (command.confirm === null || skipC24) void send(command.command, command.line);
        else setAsk({ kind: 'button', command });
      }
    }
  };

  const submit = (): void => {
    const line = text.trim();
    if (line === '') return;
    history.add(line);
    setText('');
    setChoices([]);
    setSearch(null);
    note('sent', line);
    run(classify(line, ctx));
  };

  const onAsk = (result: AskResult): void => {
    setAsk(null);
    switch (result.kind) {
      case 'cancel':
        note('note', 'Cancelled. Nothing was sent.');
        return;
      case 'send':
        void send(result.command, ask?.kind === 'button' ? ask.command.line : '');
        return;
      case 'move':
        void sendMove(result.line, result.travel, result.lowZ);
        return;
      case 'home':
        setAsk({ kind: 'button', command: { kind: 'home', command: { op: 'home', axes: [result.axis] }, confirm: 'C4', line: `G28.2 ${result.axis.toUpperCase()}0` } });
        return;
    }
  };

  const openAsJob = (lines: readonly string[]): void => {
    setPaste(null);
    void openJob(new File([asProgram(lines)], 'pasted.nc', { type: 'text/plain' }), { kind: 'picker' }).then((r) => note(r.ok ? 'note' : 'error', r.ok ? `${SYMBOL.done} Opened the pasted lines as a job. Check it in Run before you start.` : r.reason));
  };

  const searchHit = search === null ? null : history.search(search.query, search.index ?? undefined);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'r' && e.ctrlKey) {
      e.preventDefault();
      setSearch((s) => (s === null ? { query: '', index: null } : { query: s.query, index: searchHit?.index ?? s.index }));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (search !== null) {
        setText(searchHit?.line ?? text);
        setSearch(null);
        return;
      }
      submit();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      const list = choices.length > 0 ? choices : completions(text, ctx.dialect);
      if (list.length === 0) return;
      e.preventDefault();
      if (choices.length > 0) {
        setText(applyCompletion(text, list[Math.min(pick, list.length - 1)] as Completion));
        setChoices([]);
        return;
      }
      if (list.length === 1) {
        setText(applyCompletion(text, list[0] as Completion));
        return;
      }
      const prefix = commonPrefix(list);
      setText(applyCompletion(text, { text: prefix, meaning: '' }));
      setChoices(list);
      setPick(0);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const up = e.key === 'ArrowUp';
      if (choices.length > 1) {
        setPick((p) => (up ? (p - 1 + choices.length) % choices.length : (p + 1) % choices.length));
        return;
      }
      setSearch(null);
      setText(up ? history.up(text) : history.down());
    }
  };

  const onPaste = (e: ClipboardEvent): void => {
    const pasted = e.clipboardData?.getData('text') ?? '';
    if (!/[\r\n]/.test(pasted)) return;
    e.preventDefault();
    run(classify(pasted, ctx));
  };

  // What the line will do, before Enter: a move's words with the modes it runs in, or which button it presses.
  const preview = useMemo(() => {
    const t = text.trim();
    if (t === '' || search !== null) return null;
    const c = classify(t, ctx);
    if (c.kind === 'move') {
      const parsed = parseTypedLine(c.line);
      return parsed.ok ? movePreview(parsed.value, boardModes(snapshot)) : null;
    }
    if (c.kind === 'read') return `Reads ${c.token}`;
    if (c.kind === 'spindle' || c.kind === 'coolant' || c.kind === 'offset' || c.kind === 'home') return `Same as the ${c.kind === 'offset' ? 'zero and offset' : c.kind} button${c.confirm === null ? '' : `, after ${c.confirm}`}`;
    if (c.kind === 'realtime') return c.action === 'pause' ? 'Presses Pause' : c.action === 'resume' ? 'Presses Resume' : 'Presses Stop job';
    if (c.kind === 'refused') return 'Not sent: press Enter to see why';
    return null;
  }, [text, search, snapshot]);

  const running = typedRunning(snapshot) ? snapshot?.motion : null;
  const shown = visible(transcript, filter);

  return h(
    'div',
    { class: 'cl term', 'data-region': 'terminal' },
    h(
      'div',
      { class: 'cl-head' },
      h('span', { class: 'cl-title' }, Icon('terminal', 15), 'Terminal'),
      h('span', { class: 'cl-phase', 'data-terminal': 'modes', title: 'Units, distance mode and work coordinate system, as read from the board' }, isConnected ? modesLine(boardModes(snapshot)) : 'Not connected'),
      h('label', { class: 'term-filter' }, h('input', { type: 'checkbox', checked: !filter.hideStatus, 'data-terminal-filter': 'status', onChange: (e: Event) => setFilter((f) => ({ ...f, hideStatus: !(e.currentTarget as HTMLInputElement).checked })) }), ' Status'),
      h('label', { class: 'term-filter' }, h('input', { type: 'checkbox', checked: filter.raw, 'data-terminal-filter': 'raw', onChange: (e: Event) => setFilter((f) => ({ ...f, raw: (e.currentTarget as HTMLInputElement).checked })) }), ' Raw'),
      h('button', { type: 'button', class: 'small quiet-link', 'data-action': 'report-console', onClick: () => openReport({ origin: 'console' }) }, Icon('flag', 13), 'Report'),
    ),
    shown.length === 0
      ? h(
          'p',
          { class: 'cl-empty' },
          'Type a move such as ',
          h('code', null, 'g0 x10'),
          ', ',
          h('code', null, '?'),
          ' for a status report, or a setting name such as ',
          h('code', null, '$xvm'),
          '. Each line does what its button does.',
        )
      : h('ol', { class: 'cl-log term-log rows', ref: log, tabindex: 0, 'aria-label': 'Terminal', 'aria-live': 'polite', 'data-terminal': 'log' }, shown.map((e) => h(EntryRow, { key: String(e.id), entry: e }))),
    running === null || running === undefined
      ? null
      : h('p', { class: 'term-running', role: 'status', 'data-terminal': 'running' }, `${running.held ? SYMBOL.paused : SYMBOL.running} `, running.held ? 'Paused. Type ~ or press Resume to go on.' : 'Moving. Pause, Escape or Stop job stops it.'),
    paste === null
      ? null
      : h(
          'div',
          { class: 'term-paste', 'data-terminal': 'paste' },
          h('span', null, `${paste.length} lines pasted.`),
          h('button', { type: 'button', class: 'small primary', 'data-action': 'terminal-open-job', onClick: () => openAsJob(paste) }, 'Open as a job'),
          h('button', { type: 'button', class: 'small', 'data-action': 'terminal-paste-cancel', onClick: () => setPaste(null) }, 'Cancel'),
        ),
    choices.length === 0
      ? null
      : h(
          'ul',
          { class: 'cl-suggest', id: 'term-suggest', role: 'listbox', 'aria-label': 'Completions' },
          choices.map((c, i) =>
            h(
              'li',
              {
                key: c.text,
                id: `term-opt-${i}`,
                role: 'option',
                'aria-selected': i === pick ? 'true' : 'false',
                onMouseDown: (e: MouseEvent) => {
                  e.preventDefault();
                  setText(applyCompletion(text, c));
                  setChoices([]);
                },
              },
              h('code', null, c.text),
              h('span', null, c.meaning === '' ? 'No plain-words name yet' : c.meaning),
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
      h('label', { class: 'sr-only', for: 'terminal-input' }, 'Command: G-code, a setting name, ? or JSON'),
      h('span', { class: 'cl-prompt', 'aria-hidden': 'true' }, search === null ? '›' : '?'),
      h('input', {
        id: 'terminal-input',
        type: 'text',
        autoComplete: 'off',
        spellcheck: false,
        role: 'combobox',
        'aria-expanded': choices.length > 0 ? 'true' : 'false',
        ...(choices.length > 0 ? { 'aria-controls': 'term-suggest', 'aria-activedescendant': `term-opt-${pick}` } : {}),
        'aria-autocomplete': 'list',
        placeholder: search !== null ? 'Search history (Ctrl-R again for older, Enter to take it)' : isConnected ? 'g0 x10   g1 x20 f500   ?   $xvm' : 'Connect a board to use the terminal',
        value: search !== null ? search.query : text,
        maxLength: 254,
        'data-terminal': 'input',
        onInput: (e: Event) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          if (search !== null) setSearch({ query: v, index: null });
          else setText(v);
          setChoices([]);
        },
        onKeyDown: onKey,
        onPaste,
      }),
      search !== null && searchHit !== null ? h('code', { class: 'cl-preview', 'data-terminal': 'search-hit' }, searchHit.line) : preview === null ? null : h('span', { class: 'term-preview', 'data-terminal': 'preview' }, preview),
      h('button', { type: 'submit', class: 'small', 'data-machine-control': 'terminal', 'data-action': 'terminal-send', disabled: !isConnected || (text.trim() === '' && search === null), title: isConnected ? 'Send the line: it does what its button does' : 'Connect a board first' }, 'Send'),
    ),
    h(
      'p',
      { class: 'cl-hint', 'data-terminal': 'hint' },
      choices.length > 0 ? `${choices[pick]?.text ?? ''}: ${choices[pick]?.meaning ?? ''}. Tab takes it.` : waiting !== null && !typedRunning(snapshot) ? `Checking ${waiting.line}…` : '↑ ↓ history · Ctrl-R search · Tab completes · ! pauses · ~ resumes · % stops the job',
    ),
    h(TerminalAsk, { ask, model, advanced, onResult: onAsk }),
  );
}
