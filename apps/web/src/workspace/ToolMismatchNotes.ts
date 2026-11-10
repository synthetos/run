/**
 * The file-versus-tool-table note (tool-mismatch, 2026-11-10): "The file says T1 is a 6 mm end mill. Your tool
 * table's T1 is 3.175 mm." in Notes, under Needs you, with [Edit T1] and [Use the file's tool]. The second asks first,
 * then takes the file's description into the tool table (toolMismatch.ts useFilePlan). The Run step's Ready list
 * shows the same as a row (run/readyModel.ts) and calls these actions by name. The 3D view keeps drawing the table's
 * tool, and the note says so. Mounted with the Job view; nothing here sends anything to the machine.
 */
import { h, type ComponentChild } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { FileTool } from '../gcode-worker/camTools.ts';
import { toolStore } from './library.ts';
import { openToolNumber } from './toolNumbers.ts';
import { toolMismatches, useFilePlan, type ToolMismatch } from './toolMismatch.ts';
import type { Note } from './notes/notes.ts';
import { usePublishNotes } from './notes/usePublishNotes.ts';
import { useNoteActions } from './notes/noteActions.ts';
import { belowStrip, focusOnMount } from './ui.ts';

/** The action names a mismatched T number registers (the Ready list calls them too). */
export const editToolAction = (n: number): string => `tool-edit-${n}`;
export const useFileToolAction = (n: number): string => `tool-use-file-${n}`;

/** The notes for these mismatches. */
export function mismatchNotes(list: readonly ToolMismatch[]): readonly Note[] {
  return list.map((m) => ({
    id: `tool-mismatch/${m.number}`,
    topic: 'Tools',
    title: m.fileText,
    body: `${m.tableText} The 3D view draws your table’s tool.`,
    detail: `Line ${m.file.line.toLocaleString('en-US')} of the file: (${m.file.text}). Check the tool in the spindle and its length offset before you run.`,
    tone: 'warn' as const,
    link: { kind: 'action' as const, action: editToolAction(m.number), label: `Edit T${m.number}` },
    links: [{ kind: 'action' as const, action: useFileToolAction(m.number), label: 'Use the file’s tool' }],
  }));
}

export function ToolMismatchNotes({ fileTools, onView }: { readonly fileTools: readonly FileTool[]; readonly onView: (view: string) => void }): ComponentChild {
  const table = toolStore.value.value;
  const list = useMemo(() => toolMismatches(fileTools, table), [fileTools, table]);
  const [asking, setAsking] = useState<number | null>(null);
  usePublishNotes('tools', mismatchNotes(list));
  const key = list.map((m) => m.number).join(',');
  const actions = useMemo(() => {
    const map = new Map<string, () => void>();
    for (const m of list) {
      map.set(editToolAction(m.number), () => {
        openToolNumber(m.number);
        onView('tools');
      });
      map.set(useFileToolAction(m.number), () => setAsking(m.number));
    }
    return map;
  }, [key]);
  useNoteActions(actions, key);

  const asked = asking === null ? null : (list.find((m) => m.number === asking) ?? null);
  if (asked === null) return null;
  const plan = useFilePlan(table, asked.file, `mine.t${asked.number}-file-${Date.now().toString(36)}`);
  return h(
    'div',
    { class: 'dialog-wrap confirm-modal', role: 'presentation', ref: belowStrip },
    h(
      'div',
      { class: 'dialog motion-confirm tool-file-confirm', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'tool-file-title', 'data-region': 'tool-file-confirm' },
      h('h2', { id: 'tool-file-title', class: 'tool-file-title' }, `Use the file’s tool for T${asked.number}?`),
      h('p', { 'data-tool-file': 'plan' }, plan.text),
      h('p', { class: 'fine' }, 'The 3D view and the tool table use it from now on. Nothing is sent to the machine.'),
      h(
        'div',
        { class: 'motion-confirm-actions' },
        h('button', { type: 'button', class: 'small', 'data-action': 'tool-file-cancel', ref: focusOnMount, onClick: () => setAsking(null) }, 'Cancel'),
        h(
          'button',
          {
            type: 'button',
            class: 'small primary',
            'data-action': 'tool-file-confirm',
            onClick: () => {
              toolStore.set(plan.next);
              setAsking(null);
            },
          },
          'Use the file’s tool',
        ),
      ),
    ),
  );
}
