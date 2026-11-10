/**
 * The worker's wire transcript of this link, read-only (P1-08): every byte as sent and received, refreshed once a
 * second while shown, newest kept in view unless the user scrolled up. Beside the terminal (3:1), and with the
 * transcript save under it. Nothing here writes to the board.
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { TranscriptSave } from './TranscriptSave.ts';
import type { WorkspaceModel } from '../workspace/model.ts';

function hexText(hex: string): string {
  let s = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const c = Number.parseInt(hex.slice(i, i + 2), 16);
    s += c === 10 ? '' : c === 13 ? '' : c < 32 || c === 127 ? `\\x${hex.slice(i, i + 2)}` : String.fromCharCode(c);
  }
  return s;
}

interface WireLine {
  readonly t: number;
  readonly dir: string;
  readonly text: string;
}

export function WireTranscript({ model, active }: { readonly model: WorkspaceModel | null; readonly active: boolean }): ComponentChild {
  const view = model?.live.value ?? null;
  const epoch = view?.message?.snapshot.epoch ?? 0;
  const [lines, setLines] = useState<readonly WireLine[] | null>(null);
  useEffect(() => {
    if (!active || model === null || epoch === 0) return;
    let stop = false;
    const pull = async (): Promise<void> => {
      const jsonl = await model.actions.value?.transcriptText();
      if (stop || jsonl === null || jsonl === undefined) return;
      const rows = jsonl.trim() === '' ? [] : jsonl.trim().split('\n');
      const parsed: WireLine[] = [];
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
  useEffect(() => {
    const el = wire.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  const saving = view === null || view.message === null || view.message.snapshot.epoch === 0 ? null : h(TranscriptSave, { status: view.transcript, onSave: () => model?.actions.value?.saveTranscript() });
  return h(
    'div',
    { class: 'console-wire' },
    h('div', { class: 'cl-head' }, h('span', { class: 'cl-title' }, 'Wire transcript'), h('span', { class: 'cl-phase' }, 'Every byte, as sent and received')),
    epoch === 0 || lines === null
      ? h('p', { class: 'live-empty' }, h('strong', null, 'This shows the conversation with the board.'), 'Connect to see commands and replies.')
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
  );
}
