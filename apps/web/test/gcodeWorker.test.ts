/**
 * The preview pipeline in `gcode.worker` and its page client (ROADMAP TB-03).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { KIND, PREVIEW_MARK, interpretJob } from '@synthetos/gcode';
import { LINE_MARK, SEGMENT } from '@synthetos/gcode-view';
import { TINYG_EN } from '@synthetos/protocol';
import { sanitizeJob } from '@synthetos/safety';
import { createGcodePreviewClient, type WorkerLike } from '../src/gcode-worker/client.ts';
import { createGcodeHandler } from '../src/gcode-worker/handler.ts';
import { latin1, lineSpans, lineText } from '../src/gcode-worker/lines.ts';
import { MAX_FILE_BYTES, OFFLINE_MOTION, OFFLINE_START, PreviewError, analyseBytes, readBlob, transferablesOf } from '../src/gcode-worker/pipeline.ts';
import type { FromGcodeWorker, ToGcodeWorker } from '../src/gcode-worker/protocol.ts';

const CAM = fileURLToPath(new URL('../../../test-fixtures/cam/', import.meta.url));
const bytesOf = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Reference line split (SAFETY §4.7 step 1): CRLF, LFCR, CR, LF; a final terminator starts no line. */
function referenceLines(text: string): string[] {
  if (text === '') return [];
  const parts = text.split(/\r\n|\n\r|\r|\n/);
  if (/[\r\n]$/.test(text)) parts.pop();
  return parts;
}

describe('line spans', () => {
  it('split exactly as the sanitiser does, for any mix of terminators (property)', () => {
    const ch = fc.constantFrom('a', 'G', '1', ' ', '\r', '\n', '\x80', '\xff');
    fc.assert(fc.property(fc.array(ch, { maxLength: 60 }).map((a) => a.join('')), (text) => {
      const bytes = bytesOf(text);
      const spans = lineSpans(bytes);
      const lines = Array.from({ length: spans.length / 2 }, (_, i) => lineText(bytes, spans, i));
      expect(lines).toEqual(referenceLines(text));
    }));
  });

  it('decodes bytes one to one', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const s = latin1(all);
    expect(s.length).toBe(256);
    expect(Array.from(s, (c) => c.charCodeAt(0))).toEqual(Array.from(all));
  });
});

describe('the preview draws exactly the interpretation of the sanitised lines', () => {
  const files = readdirSync(CAM).filter((f) => f.endsWith('.nc'));

  it.each(files)('%s', (file) => {
    const bytes = new Uint8Array(readFileSync(CAM + file));
    const { result } = analyseBytes(bytes, { dialect: 'tinyg-en', mode: 'auto' });
    const sanitized = sanitizeJob(readFileSync(CAM + file, 'latin1'), TINYG_EN, { motion: OFFLINE_MOTION, start: OFFLINE_START });
    const direct = interpretJob(sanitized, TINYG_EN, { start: OFFLINE_START });
    expect(result.segments).not.toBeNull();
    expect(Array.from(result.segments?.vertices ?? [])).toEqual(Array.from(direct.vertices));
    expect(Array.from(result.segments?.kinds ?? [])).toEqual(Array.from(direct.kinds));
    expect(Array.from(result.segments?.lineToVertex ?? [])).toEqual(Array.from(direct.lineToVertex));
    expect(Array.from(result.sourceLines)).toEqual(sanitized.lines.map((l) => l.sourceLine));
    expect(result.summary.blocked).toBe(direct.blocked);
    for (const f of direct.findings) if (f.line > 0) expect(f.line).toBeLessThanOrEqual(result.fileLines);
  });

  it('the vertex and mark codes the gcode package emits are the codes the viewer reads', () => {
    expect({ ...SEGMENT }).toEqual({ ...KIND });
    expect({ ...LINE_MARK }).toEqual({ ...PREVIEW_MARK });
  });

  it('a blocked line carries the block verdict in the list', () => {
    const { result } = analyseBytes(bytesOf('G21 G90\nG0 X1\nG28.3 X0\nM30\n'), { dialect: 'tinyg-en', mode: 'auto' });
    expect(result.summary.blocked).toBe(true);
    expect(result.verdicts[2]).toBe(4);
    expect(result.verdicts[1]).toBeLessThan(4);
  });
});

describe('lite mode', () => {
  it('on request keeps no 3D geometry but still gives verdicts, the line list and the frame table', () => {
    const { result } = analyseBytes(bytesOf('G21 G90\nG92 X5\nG1 X10 F100\nM30\n'), { dialect: 'tinyg-en', mode: 'lite' });
    expect(result.lite).toBe(true);
    expect(result.liteBySize).toBe(false);
    expect(result.segments).toBeNull();
    expect(result.verdicts.length).toBe(4);
    // The program-to-path offsets (gcode frames.ts): -5 in X from line 2, none after M30.
    expect(Array.from(result.frameTable.lines)).toEqual([0, 2, 4]);
    expect(Array.from(result.frameTable.offsets)).toEqual([0, 0, 0, -5, 0, 0, 0, 0, 0]);
    expect(Array.from(result.frameTable.g92Lines)).toEqual([2]);
    expect(transferablesOf(result)).toHaveLength(11); // ...and the analysis' rapid deltas (docs/design/ANALYZE.md)
  });
});

describe('reading and limits', () => {
  it('reads a blob in chunks with progress', async () => {
    const seen: number[] = [];
    const bytes = await readBlob(new Blob(['G1 X1\n'.repeat(50_000)]), (p) => { if (p.phase === 'read') seen.push(p.fraction); });
    expect(bytes.length).toBe(300_000);
    expect(seen.at(-1)).toBe(1);
  });

  it('refuses a file over 50 MB before reading it', async () => {
    const big = { size: MAX_FILE_BYTES + 1, stream: () => { throw new Error('must not read'); } } as unknown as Blob;
    await expect(readBlob(big)).rejects.toBeInstanceOf(PreviewError);
  });

  it('refuses a dialect the preview does not offer', () => {
    expect(() => analyseBytes(bytesOf('G0 X1\n'), { dialect: 'g2core-edge', mode: 'auto' })).toThrow(PreviewError);
  });
});

describe('worker handler', () => {
  it('posts progress, then the result with its buffers transferred; answers findings by line range', async () => {
    const posted: Array<{ m: FromGcodeWorker; t: Transferable[] | undefined }> = [];
    const handle = createGcodeHandler((m, t) => { posted.push({ m, t }); });
    await handle({ type: 'load', id: 1, blob: new Blob(['G21 G90\nG0 X1\nG28.3 X0\nM30\n']), request: { dialect: 'tinyg-en', mode: 'auto' } });
    const result = posted.at(-1);
    expect(result?.m.type).toBe('result');
    expect(posted.slice(0, -1).every((p) => p.m.type === 'progress')).toBe(true);
    expect(result?.t?.length).toBe(15);
    await handle({ type: 'findings', id: 2, from: 3, to: 3 });
    const f = posted.at(-1)?.m;
    expect(f?.type === 'findings' && f.findings.length > 0 && f.findings.every((x) => x.line === 3)).toBe(true);
  });

  it('reports a failure as an error message, not a crash', async () => {
    const posted: FromGcodeWorker[] = [];
    const handle = createGcodeHandler((m) => { posted.push(m); });
    await handle({ type: 'load', id: 7, blob: new Blob(['G0 X1']), request: { dialect: 'g2core-edge', mode: 'auto' } });
    expect(posted.at(-1)).toMatchObject({ type: 'error', id: 7 });
  });
});

/** A worker that runs the real handler in-process, with a hook to hold messages. */
function inProcessWorker(log: string[]): WorkerLike {
  let terminated = false;
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message: ToGcodeWorker) {
      log.push(`post:${message.type}`);
      void handle(message);
    },
    terminate() {
      terminated = true;
      log.push('terminate');
    },
  };
  const handle = createGcodeHandler((m) => {
    if (!terminated) w.onmessage?.({ data: m } as MessageEvent<FromGcodeWorker>);
  });
  return w;
}

describe('page client', () => {
  it('loads through the worker and fetches findings for a range', async () => {
    const log: string[] = [];
    const client = createGcodePreviewClient(() => inProcessWorker(log));
    expect(await client.findings(1, 10)).toEqual([]);
    const r = await client.load(new Blob(['G21 G90\nG0 X1\nG28.3 X0\nM30\n']), { dialect: 'tinyg-en', mode: 'auto' });
    expect(r.fileLines).toBe(4);
    expect((await client.findings(3, 3)).length).toBeGreaterThan(0);
  });

  it('cancel terminates the worker at once and the load rejects with AbortError', async () => {
    const log: string[] = [];
    const client = createGcodePreviewClient(() => inProcessWorker(log));
    const p = client.load(new Blob(['G1 X1 F100\n'.repeat(20_000)]), { dialect: 'tinyg-en', mode: 'auto' });
    client.cancel();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(log).toEqual(['post:load', 'terminate']);
  });

  it('a new load replaces the running one with a fresh worker', async () => {
    const log: string[] = [];
    let spawned = 0;
    const client = createGcodePreviewClient(() => { spawned++; return inProcessWorker(log); });
    const first = client.load(new Blob(['G1 X1 F100\n'.repeat(20_000)]), { dialect: 'tinyg-en', mode: 'auto' });
    const second = client.load(new Blob(['G21 G90\nG1 X1 F100\n']), { dialect: 'tinyg-en', mode: 'auto' });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect((await second).fileLines).toBe(2);
    expect(spawned).toBe(2);
  });

  it('a worker crash rejects the load instead of hanging', async () => {
    let w: WorkerLike | null = null;
    const client = createGcodePreviewClient(() => {
      w = { onmessage: null, onerror: null, postMessage: () => {}, terminate: () => {} };
      return w;
    });
    const p = client.load(new Blob(['G0 X1']), { dialect: 'tinyg-en', mode: 'auto' });
    (w as unknown as WorkerLike).onerror?.({ message: 'boom', preventDefault: () => {} } as ErrorEvent);
    await expect(p).rejects.toThrow(/boom/);
  });
});
