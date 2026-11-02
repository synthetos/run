/**
 * Saves the wire transcript as a file (P1-08). The JSONL is data, never
 * markup: it goes into a Blob for an `<a download>` link only, and is never
 * opened as a document.
 */
export function downloadTranscript(doc: Document, jsonl: string, name: string): void {
  const url = URL.createObjectURL(new Blob([jsonl], { type: 'application/x-ndjson' }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
