/**
 * ROADMAP P1-01 acceptance: "the ReplayTransport conformance suite passes
 * against EN-HIL transcripts" (OLD-TP §9.1 item 4: one suite runs against
 * the simulated link and against replays).
 *
 * Each recording is replayed twice, through the production guard:
 * - to the test kit's `ReplayTransport` directly;
 * - to the real `WebSerialTransport`, over a `SerialPort` whose wire is a
 *   second `ReplayTransport` of the same recording.
 * Both runs must read exactly the recorded bytes, write exactly the recorded
 * bytes, finish the recording, and fail the same way on a divergence.
 *
 * The recordings are:
 * - the EN-HIL bench transcripts in test-fixtures/en-hil/ (every line a
 *   TinyG board sent during the recorded runs, edge-next and 440 lineage,
 *   all three footer revisions and both banner shapes);
 * - live sessions of the test kit's edge-next and 440 models, captured
 *   through `WebSerialTransport` over `MockSerialPort` and turned into
 *   recordings (`recordingFromTranscript`): the transport's live behaviour
 *   and its replayed behaviour agree byte for byte.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BYTE } from '@synthetos/protocol';
import {
  MockSerialPort,
  ReplayTransport,
  SimEndpoint,
  TinyG440Model,
  TinyGEdgeNextModel,
  VirtualClock,
  recordingFromTranscript,
  settle,
  type Recording,
  type RecordingStep,
} from '@synthetos/testkit';
import { describe, expect, it } from 'vitest';
import { GuardedTransport } from '../src/guardedTransport.ts';
import { SESSION_OPEN_OPTIONS } from '../src/openPolicy.ts';
import type { Transport } from '../src/transport.ts';
import { WebSerialTransport } from '../src/webSerialTransport.ts';
import { enc } from './fakeTransport.ts';
import { ReplaySerialPort } from './serialPorts.ts';

const EN_HIL = resolve(import.meta.dirname, '../../../test-fixtures/en-hil');

/** The board's lines from one EN-HIL fixture file (`<kind>\t<line>`, `#` comments), each as sent with its LF. */
function enHilLines(file: string): string[] {
  return readFileSync(join(EN_HIL, file), 'utf8')
    .split('\n')
    .filter((row) => row !== '' && !row.startsWith('#'))
    .map((row) => {
      const tab = row.indexOf('\t');
      if (tab < 0) throw new Error(`${file}: not "<kind>\\t<line>": ${row}`);
      return `${row.slice(tab + 1)}\n`;
    });
}

const EN_HIL_FILES = readdirSync(EN_HIL)
  .filter((f) => f.endsWith('.txt'))
  .sort();

type Path = 'replay' | 'web-serial';
const PATHS: readonly Path[] = ['replay', 'web-serial'];

interface Run {
  readonly transport: GuardedTransport;
  readonly replay: ReplayTransport;
  readonly clock: VirtualClock;
  readonly read: number[];
  readonly reading: Promise<unknown>;
}

async function start(path: Path, recording: Recording): Promise<Run> {
  const clock = new VirtualClock();
  const replay = new ReplayTransport(recording, { clock });
  const inner: Transport = path === 'replay' ? replay : new WebSerialTransport(new ReplaySerialPort(replay));
  const transport = new GuardedTransport(inner);
  await transport.open(SESSION_OPEN_OPTIONS);
  const read: number[] = [];
  const reading = (async () => {
    for await (const chunk of transport.readable) read.push(...chunk);
  })().catch((e: unknown) => e);
  return { transport, replay, clock, read, reading };
}

async function finish(run: Run): Promise<void> {
  await run.clock.advanceAsync(10_000);
  await settle();
  await run.transport.close();
  await run.reading;
}

describe('EN-HIL bench transcripts replay identically to ReplayTransport and to WebSerialTransport', () => {
  it('there are EN-HIL transcripts to replay', () => {
    expect(EN_HIL_FILES).toEqual(expect.arrayContaining(['e031-limit-stop.txt', 'harness-lines.txt']));
  });

  it.each(EN_HIL_FILES)('%s: every byte the board sent arrives unchanged, in order, on both paths', async (file) => {
    const lines = enHilLines(file);
    expect(lines.length).toBeGreaterThan(0);
    const steps: RecordingStep[] = lines.map((l) => ({ emit: enc(l), afterMs: 1 }));
    const recording: Recording = { name: file, steps };
    const expected = Array.from(enc(lines.join('')));
    for (const path of PATHS) {
      const run = await start(path, recording);
      await finish(run);
      expect(run.replay.divergence, `${file} via ${path}`).toBeNull();
      expect(run.replay.finished, `${file} via ${path}`).toBe(true);
      expect(run.read, `${file} via ${path}`).toEqual(expected);
    }
  });

  it.each(EN_HIL_FILES)('%s: the host\'s first line and a feedhold are matched against the recording on both paths', async (file) => {
    const lines = enHilLines(file);
    const steps: RecordingStep[] = [
      { expect: enc('{"sr":null}\n') },
      ...lines.map((l) => ({ emit: enc(l), afterMs: 1 })),
      { expect: Uint8Array.of(BYTE.FEEDHOLD) },
    ];
    for (const path of PATHS) {
      const run = await start(path, { name: file, steps });
      await run.transport.writeLine(enc('{"sr":null}\n'));
      await run.clock.advanceAsync(lines.length + 5);
      await settle();
      await run.transport.writeLine(Uint8Array.of(BYTE.FEEDHOLD));
      await finish(run);
      expect(run.replay.divergence, `${file} via ${path}`).toBeNull();
      expect(run.replay.finished, `${file} via ${path}`).toBe(true);
      expect(run.read, `${file} via ${path}`).toEqual(Array.from(enc(lines.join(''))));
    }
  });
});

describe('a divergence fails the same way on both paths', () => {
  const recording: Recording = { name: 'probe', steps: [{ expect: enc('{"sr":null}\n') }, { emit: enc('{"r":{"sr":{"stat":1}},"f":[3,0,10]}\n'), afterMs: 1 }] };

  it.each(PATHS)('via %s: a wrong first line is a failed write, and the guard refuses every further line', async (path) => {
    const run = await start(path, recording);
    await expect(run.transport.writeLine(enc('{"fb":null}\n'))).rejects.toThrow(/write failed/);
    expect(run.transport.writeFailed).toBe(true);
    expect(run.replay.divergence).toMatchObject({ step: 0, reason: 'unexpected-bytes' });
    await expect(run.transport.writeLine(enc('{"sr":null}\n'))).rejects.toMatchObject({ code: 'line-after-write-failure' });
    expect(await run.reading).toMatchObject({ name: 'ReplayDivergenceError' });
  });

  it.each(PATHS)('via %s: a recorded link drop reaches the guard', async (path) => {
    const run = await start(path, { name: 'drop', steps: [{ emit: enc('{"r":{}}\n'), afterMs: 1 }, { disconnect: true, afterMs: 1 }] });
    await run.clock.advanceAsync(5);
    await settle();
    expect(run.transport.disconnected).toBe(true);
    await expect(run.transport.writeLine(Uint8Array.of(BYTE.FEEDHOLD))).rejects.toMatchObject({ code: 'disconnected' });
    expect(run.read).toEqual(Array.from(enc('{"r":{}}\n')));
  });
});

describe('the transport live against the firmware models agrees with its own replay', () => {
  const SCRIPT: readonly Uint8Array[] = [enc('{"sr":null}\n'), enc('{"fb":null}\n'), enc('{"qr":null}\n'), Uint8Array.of(BYTE.FEEDHOLD)];

  async function live(model: 'edge-next' | '440'): Promise<{ recording: Recording; read: number[] }> {
    const clock = new VirtualClock();
    const device = model === 'edge-next' ? new TinyGEdgeNextModel() : new TinyG440Model();
    const endpoint = new SimEndpoint({ clock, device });
    const transport = new GuardedTransport(new WebSerialTransport(new MockSerialPort(endpoint)));
    await transport.open(SESSION_OPEN_OPTIONS);
    const read: number[] = [];
    const reading = (async () => {
      for await (const chunk of transport.readable) read.push(...chunk);
    })();
    for (const bytes of SCRIPT) {
      await transport.writeLine(bytes);
      await clock.advanceAsync(200);
      await settle();
    }
    await transport.close();
    await reading;
    return { recording: recordingFromTranscript(model, endpoint.transcript), read };
  }

  it.each(['edge-next', '440'] as const)('%s: the live session, replayed on both paths, reads and writes the same bytes', async (model) => {
    const { recording, read } = await live(model);
    expect(read.length).toBeGreaterThan(0);
    expect(recording.steps.filter((s) => 'expect' in s)).toHaveLength(SCRIPT.length);
    for (const path of PATHS) {
      const run = await start(path, recording);
      for (const bytes of SCRIPT) {
        await run.transport.writeLine(bytes);
        await run.clock.advanceAsync(200);
        await settle();
      }
      await finish(run);
      expect(run.replay.divergence, `${model} via ${path}`).toBeNull();
      expect(run.replay.finished, `${model} via ${path}`).toBe(true);
      expect(run.read, `${model} via ${path}`).toEqual(read);
    }
  });
});
