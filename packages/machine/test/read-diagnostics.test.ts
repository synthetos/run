import { describe, expect, it } from 'vitest';
import { linkDiagnosticsSnapshot, readErrorText } from '../src/readDiagnostics.ts';

describe('receive diagnostics', () => {
  it('keeps original errors in the worker and serializes bounded text only', () => {
    const original = new TypeError('x'.repeat(600));
    const transport = { portOpen: true, readerAcquired: true, readCompletions: 1, rxBytes: 0, ended: true, error: original };
    const d = { portOpen: true, readerStarted: true, rxBytes: 0, ended: true, error: original, transport };
    const snapshot = linkDiagnosticsSnapshot(d);
    expect(snapshot.error).toHaveLength(512);
    expect(snapshot.transport?.error).toHaveLength(512);
    expect(d.error).toBe(original);
    expect(transport.error).toBe(original);
    expect(readErrorText('reader failed')).toBe('reader failed');
    expect(readErrorText(null)).toBeNull();
  });
  it('makes unavailable transport evidence explicit', () => {
    expect(linkDiagnosticsSnapshot({ portOpen: false, readerStarted: false, rxBytes: 0, ended: false, error: null, transport: null })).toMatchObject({ transport: null, error: null });
  });
});
