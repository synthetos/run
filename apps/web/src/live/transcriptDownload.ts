/**
 * Saves the wire transcript (P1-08) or a settings backup as a file. The
 * text is data, never markup: it goes into a Blob for an `<a download>` link only, and is never
 * opened as a document.
 */
export function downloadTranscript(doc: Document, jsonl: string, name: string, type = 'application/x-ndjson'): void {
  const url = URL.createObjectURL(new Blob([jsonl], { type }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
