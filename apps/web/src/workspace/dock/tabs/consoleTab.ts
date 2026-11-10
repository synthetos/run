/** The dock's Console tab (Advanced only): the typed console line and the worker's wire transcript of this link. */
import { h, type ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { TranscriptSave } from '../../../machine-ui/TranscriptSave.ts';
import { ConsoleLine } from '../../../console/ConsoleLine.ts';
import type { WorkspaceModel } from '../../model.ts';
import type { DockContext, DockTab } from '../dockTab.ts';

function hexText(hex: string): string {
  let s = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const c = Number.parseInt(hex.slice(i, i + 2), 16);
    s += c === 10 ? '' : c === 13 ? '' : c < 32 || c === 127 ? `\\x${hex.slice(i, i + 2)}` : String.fromCharCode(c);
  }
  return s;
}

interface ConsoleLine {
  readonly t: number;
  readonly dir: string;
  readonly text: string;
}

/** The Console tab: the worker's wire transcript of this link, read-only, refreshed while the tab is open. */
function ConsolePane({ model, active }: { readonly model: WorkspaceModel | null; readonly active: boolean }): ComponentChild {
  const view = model?.live.value ?? null;
  const epoch = view?.message?.snapshot.epoch ?? 0;
  const [lines, setLines] = useState<readonly ConsoleLine[] | null>(null);
  useEffect(() => {
    if (!active || model === null || epoch === 0) return;
    let stop = false;
    const pull = async (): Promise<void> => {
      const jsonl = await model.actions.value?.transcriptText();
      if (stop || jsonl === null || jsonl === undefined) return;
      const rows = jsonl.trim() === '' ? [] : jsonl.trim().split('\n');
      const parsed: ConsoleLine[] = [];
      for (const row of rows.slice(-400)) {
        try {
          const e = JSON.parse(row) as { t?: unknown; dir?: unknown; hex?: unknown };
          if (typeof e.t === 'number' && typeof e.dir === 'string' && typeof e.hex === 'string') parsed.push({ t: e.t, dir: e.dir, text: hexText(e.hex) });
        } catch {
          // A damaged row is skipped.
        }
      }
      setLines(parsed);
    };
    void pull();
    const timer = setInterval(() => void pull(), 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [active, model, epoch]);
  const t0 = lines?.[0]?.t ?? 0;
  const wire = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  // Keep the newest line in view, unless the user scrolled up to read.
  useEffect(() => {
    const el = wire.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  const saving = view === null || view.message === null || view.message.snapshot.epoch === 0 ? null : h(TranscriptSave, { status: view.transcript, onSave: () => model?.actions.value?.saveTranscript() });
  return h(
    'div',
    { class: 'console-pane' },
    h(ConsoleLine, { model }),
    h(
      'div',
      { class: 'console-wire' },
      h('div', { class: 'cl-head' }, h('span', { class: 'cl-title' }, 'Wire transcript'), h('span', { class: 'cl-phase' }, 'Every byte, as sent and received')),
      epoch === 0 || lines === null
        ? h('p', { class: 'live-empty' }, h('strong', null, 'The console shows the conversation with the board.'), 'Connect to see commands and replies.')
        : h(
            'ol',
            {
              class: 'console',
              ref: wire,
              'data-console': 'lines',
              'aria-label': 'Wire transcript',
              onScroll: (e: Event) => {
                const el = e.currentTarget as HTMLOListElement;
                pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              },
            },
            lines.map((l, i) => h('li', { key: String(i), class: l.dir === 'tx' ? 'tx' : 'rx' }, h('time', null, `${((l.t - t0) / 1000).toFixed(2)}`), h('span', { class: 'dir' }, l.dir === 'tx' ? '→' : '←'), h('span', null, l.text))),
          ),
      saving === null ? null : h('details', { class: 'wire-save' }, h('summary', null, 'Save the transcript'), saving),
    ),
  );
}

function ConsoleTabPane({ ctx, active }: { readonly ctx: DockContext; readonly active: boolean }): ComponentChild {
  return h(ConsolePane, { model: ctx.model, active });
}

export const consoleTab: DockTab = {
  id: 'console',
  label: 'Console',
  available: (ctx) => ctx.advanced,
  Pane: ConsoleTabPane,
};
