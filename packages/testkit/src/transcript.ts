/**
 * Transcripts (ROADMAP P0-11 determinism acceptance; RUN_PLAN §8.1).
 *
 * A transcript is the ordered record of everything that crossed the
 * simulated link, as the host saw it, plus the faults and device events that
 * shaped it. Two runs with the same seed and fault plan must render to the
 * same string, byte for byte. Times are virtual milliseconds with three
 * decimals, so the rendering never depends on float formatting quirks.
 */
import './marker.ts';
import { escapeBytes } from './bytes.ts';

export type TranscriptKind =
  /** The host wrote these bytes to the port. */
  | 'host-write'
  /** The host's port delivered these bytes (after any fault). */
  | 'host-read'
  /** A fault plan step acted (drop, corrupt, disconnect, ...). */
  | 'fault'
  /** Something the device did that the bytes alone do not show (reset, side effect of a GET). */
  | 'device'
  /** The link went down. */
  | 'link';

export interface TranscriptEntry {
  readonly t: number;
  readonly kind: TranscriptKind;
  /** Bytes for host-write / host-read; empty otherwise. */
  readonly data: Uint8Array;
  /** Free text for fault, device and link entries. */
  readonly note: string;
}

const LABEL: Record<TranscriptKind, string> = {
  'host-write': 'H>',
  'host-read': 'H<',
  fault: '!!',
  device: 'DV',
  link: 'LK',
};

export class Transcript {
  readonly #entries: TranscriptEntry[] = [];

  record(entry: { t: number; kind: TranscriptKind; data?: Uint8Array; note?: string }): void {
    this.#entries.push(Object.freeze({ t: entry.t, kind: entry.kind, data: entry.data ?? new Uint8Array(0), note: entry.note ?? '' }));
  }

  entries(): readonly TranscriptEntry[] {
    return this.#entries;
  }

  /** All bytes of one kind, concatenated in order. */
  bytesOf(kind: 'host-write' | 'host-read'): Uint8Array {
    const parts = this.#entries.filter((e) => e.kind === kind);
    const out = new Uint8Array(parts.reduce((n, e) => n + e.data.length, 0));
    let at = 0;
    for (const e of parts) {
      out.set(e.data, at);
      at += e.data.length;
    }
    return out;
  }

  /** The canonical text rendering used for byte-identical comparisons. */
  render(): string {
    return this.#entries
      .map((e) => {
        const body = e.kind === 'host-write' || e.kind === 'host-read' ? escapeBytes(e.data) : e.note;
        return `${e.t.toFixed(3).padStart(12, '0')} ${LABEL[e.kind]} ${body}`;
      })
      .join('\n');
  }
}
