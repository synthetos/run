import { flashTranscriptFileName, transcriptFileName, type TranscriptStatus } from '../machine-ui/TranscriptSave.ts';
import type { callMachineWorker } from '../machine-worker/client.ts';
import { RPC_VERSION, type MachineReply } from '../machine-worker/rpc.ts';

/**
 * Saves the wire transcript (P1-08), a settings backup or the report files as a file. The
 * data is never markup: it goes into a Blob for an `<a download>` link only, and is never
 * opened as a document.
 */
export function downloadTranscript(doc: Document, data: string | Uint8Array, name: string, type = 'application/x-ndjson'): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Save the raw machine/flash JSONL and separate bounded entry metadata. */
export function downloadSavedTranscripts(doc: Document, reply: Extract<MachineReply, { kind: 'transcript'; ok: true }>, now: Date): TranscriptStatus {
  const name = transcriptFileName(now);
  downloadTranscript(doc, reply.jsonl, name);
  if (reply.flash !== undefined) {
    const flashName = flashTranscriptFileName(now);
    downloadTranscript(doc, reply.flash.jsonl, flashName);
    if (reply.flash.entryJson != null) downloadTranscript(doc, reply.flash.entryJson, flashName.replace(/\.jsonl$/, '.entry.json'), 'application/json');
  }
  return { kind: 'saved', name, events: reply.events };
}

export async function readTranscriptText(worker: Worker | null, call: typeof callMachineWorker): Promise<string | null> {
  if (worker === null) return null;
  const reply = await call(worker, { v: RPC_VERSION, kind: 'transcript' }).catch(() => null);
  return reply !== null && reply.ok && reply.kind === 'transcript' ? reply.jsonl : null;
}

/**
 * Bench only (the /console feed): the machine transcript, then the flash transcript's lines tagged `"src":"flash"`,
 * then the entry record as one `"src":"entry"` line, so a failed update can be read on this computer.
 */
export async function readBenchConsoleText(worker: Worker | null, call: typeof callMachineWorker): Promise<string | null> {
  if (worker === null) return null;
  const reply = await call(worker, { v: RPC_VERSION, kind: 'transcript' }).catch(() => null);
  if (reply === null || !reply.ok || reply.kind !== 'transcript') return null;
  if (reply.flash === undefined) return reply.jsonl;
  const flash = reply.flash.jsonl.split('\n').filter((l) => l.startsWith('{')).map((l) => `{"src":"flash",${l.slice(1)}`);
  const entry = reply.flash.entryJson == null ? [] : [JSON.stringify({ src: 'entry', entry: JSON.parse(reply.flash.entryJson) as unknown })];
  return [reply.jsonl.trimEnd(), ...flash, ...entry].join('\n') + '\n';
}
