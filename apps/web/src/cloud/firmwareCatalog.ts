/** Public same-origin metadata; no URL or repository is supplied by the caller. */
export async function fetchFirmwareCatalog(): Promise<unknown> {
  const response = await fetch('/api/firmware/releases', { credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
  if (!response.ok || response.body === null) throw new Error('The GitHub release list could not load. Try again.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512000) { await reader.cancel(); throw new Error('The release list exceeds the size limit.'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  return JSON.parse(text) as unknown;
}
