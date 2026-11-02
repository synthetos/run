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
