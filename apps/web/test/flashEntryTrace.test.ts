import { describe, expect, it, vi } from 'vitest';
import { EventLog, type LinkDiagnostics } from '@synthetos/machine';
import { FlashEntryTrace, flashTranscriptReport } from '../src/machine-worker/flashEntryTrace.ts';

function link(): { diagnostics: LinkDiagnostics } {
  return { diagnostics: { portOpen: true, readerStarted: true, rxBytes: 0, ended: false, error: null, transport: null } };
}
describe('bounded flash entry metadata', () => {
  it('records worker build, run id and branch without changing the raw transcript', () => {
    const build = { version: '0.0.0', sha: 'a'.repeat(40) };
    vi.stubGlobal('__RUN_BUILD__', build);
    try {
      const trace = new FlashEntryTrace(7, true); trace.viaBoot = true;
      const port = link(); trace.track(port);
      port.diagnostics.rxBytes = 7;
      const log = new EventLog(0); const raw = log.toJsonl();
      const report = flashTranscriptReport(log, trace);
      expect(report?.jsonl).toBe(raw);
      expect(JSON.parse(report?.entryJson ?? '{}')).toMatchObject({ workerBuild: build, runId: 7, recovery: true, viaBoot: true, links: [{ rxBytes: 7 }] });
    } finally { vi.unstubAllGlobals(); }
  });
  it('keeps at most eight links, counts omissions and bounds error text', () => {
    const trace = new FlashEntryTrace(1, false);
    for (let i = 0; i < 9; i++) trace.track(link());
    const last = link(); const error = new Error('x'.repeat(900));
    last.diagnostics.error = error;
    trace.track(last);
    const snapshot = JSON.parse(trace.json()) as { omittedLinks: number; links: { error: string | null }[] };
    expect(snapshot.omittedLinks).toBe(2);
    expect(snapshot.links).toHaveLength(8);
    expect(snapshot.links.at(-1)?.error).toHaveLength(512);
    expect(last.diagnostics.error).toBe(error);
  });
  it('keeps missing logs and traces explicit', () => {
    expect(flashTranscriptReport(null, null)).toBeNull();
    expect(flashTranscriptReport(new EventLog(0), null)?.entryJson).toBeNull();
  });
});
