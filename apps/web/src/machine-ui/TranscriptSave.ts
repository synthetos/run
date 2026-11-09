/**
 * "Save transcript" (P1-08; docs/bench/GUIDE.md section 7): downloads the
 * machine worker's wire transcript of the last connection (`transcript`
 * request, `{t, dir, hex}` JSONL, one object per line) as a file whose name
 * carries the date and time. After a firmware update, the bootloader link's
 * bytes (the flash transcript, same format) are saved next to it.
 *
 * The transcript holds every byte the board sent, so it holds the board's
 * unique per-chip hardware id (its answer to the `id` read, as hex). The
 * panel says so next to the button: keep the file private, never commit it
 * or attach it to a public issue (docs/bench/GUIDE.md section 9). It is not
 * redacted: a redacted transcript would no longer replay byte for byte.
 *
 * A pure function of its props; live/mount.ts asks the worker and saves.
 */
import { h, type ComponentChild } from 'preact';

export type TranscriptStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved'; readonly name: string; readonly events: number }
  | { readonly kind: 'failed'; readonly message: string };

/** `run-transcript-2026-11-02T07-15-26Z.jsonl`: UTC, no colons (they are not allowed in Windows file names). */
export function transcriptFileName(now: Date): string {
  return `run-transcript-${now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')}.jsonl`;
}

/** `run-flash-transcript-…jsonl`: the bootloader link's bytes from the last firmware update, saved alongside. */
export function flashTranscriptFileName(now: Date): string {
  return transcriptFileName(now).replace(/^run-transcript-/, 'run-flash-transcript-');
}

export const TRANSCRIPT_PRIVACY =
  "The transcript contains this board's unique hardware id (its answer to the id read, stored as hex). Keep the file private: do not commit it or attach it to a public issue. Share it only privately with the person helping you.";

export interface TranscriptSaveProps {
  readonly status: TranscriptStatus;
  readonly onSave: () => void;
}

function statusLine(status: TranscriptStatus): ComponentChild {
  switch (status.kind) {
    case 'idle':
      return null;
    case 'saving':
      return h('p', { role: 'status', 'data-transcript': 'saving' }, 'Asking the machine worker for the transcript…');
    case 'saved':
      return h('p', { role: 'status', 'data-transcript': 'saved' }, `Saved ${status.name} (${status.events} events).`);
    case 'failed':
      return h('p', { role: 'alert', 'data-transcript': 'failed' }, 'The transcript could not be saved: ', status.message);
  }
}

export function TranscriptSave({ status, onSave }: TranscriptSaveProps): ComponentChild {
  return h(
    'section',
    { class: 'transcript-save', 'data-region': 'transcript', 'aria-labelledby': 'transcript-title' },
    h('h2', { id: 'transcript-title' }, 'Wire transcript'),
    h('p', null, 'Every byte written to and read from the board on the last connection, with times, as JSONL ({t, dir, hex} per line). It replays byte for byte.'),
    h('p', { class: 'transcript-privacy', role: 'note', 'data-transcript': 'privacy' }, TRANSCRIPT_PRIVACY),
    h('button', { type: 'button', class: 'button', 'data-action': 'save-transcript', disabled: status.kind === 'saving', onClick: onSave }, 'Save transcript'),
    statusLine(status),
  );
}
