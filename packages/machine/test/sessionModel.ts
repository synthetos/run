/**
 * The P1-02 model test, shared by the test files that split its sessions
 * across workers: random read-only sessions against both test-kit firmware
 * models, with random user requests, random device faults and random link
 * faults, and a check of every byte the session wrote.
 *
 * ROADMAP P1-02 acceptance: "across 10k random sessions against both
 * test-kit models, the first line is {"sr":null} and only allowlisted GETs,
 * ENQ (EN, never before a rev-2/3 footer) and ! are written."
 */
import { createInboundDecoder, type DialectId } from '@synthetos/protocol';
import { INTENTS, type Intent } from '@synthetos/safety';
import { isReadAllowed } from '@synthetos/schema';
import { SeededRng, type Fault } from '@synthetos/testkit';
import { PROBE_TOKENS } from '../src/index.ts';
import { harness, type ModelName } from './sessionHarness.ts';
import { PORT, shown } from './simTransport.ts';

/** Tokens no read path may ever emit (T-S38). */
export const NEVER_READ: readonly string[] = ['adc3', 'md', 'me', 'alarm', 'panic', 'shutd', 'er', 'clear', 'clr', 'boot', 'jog', 'jogx', 'defa', 'test', 'help'];

/** Tokens the random sessions ask to read: allowlisted ones, forbidden ones and junk shaped to break a GET. */
const READ_POOL: readonly string[] = [
  'posx', 'posy', 'mpox', 'stat', 'vel', 'qr', 'unit', 'xvm', 'xjm', '1ma', 'sys', 'x', 'line', 'homx', '_cs1',
  ...NEVER_READ,
  'sr', 'fbs', 'spep', 'zzz', '', ' ', 'posx":1,"md', 'md\n', '{"md":null}', '!', '\u0018', 'G0X10', '$md', 'POSX', 'posx ',
];

const OTHER_INTENTS: readonly Intent[] = INTENTS.filter(
  (i) => !['connect', 'disconnect', 'feedhold', 'stopJob', 'spindleOffNow', 'ackFault', 'acknowledgeLost', 'enq', 'read'].includes(i),
);

export interface SessionVerdict {
  readonly seed: number;
  readonly model: ModelName;
  readonly problems: readonly string[];
  readonly reachedConnected: boolean;
  readonly writes: number;
  readonly enqWritten: number;
  readonly feedholdWritten: number;
  readonly requestReads: number;
}

/** Sessions across both models (ROADMAP P1-02: 10k). `RUN_MODEL_SESSIONS` may raise it for a soak run. */
export const MODEL_SESSIONS = Math.max(10_000, Number(process.env['RUN_MODEL_SESSIONS'] ?? 0) || 0);

export interface ModelRun {
  readonly sessions: number;
  readonly connected: number;
  readonly enqWritten: number;
  readonly feedholdWritten: number;
  readonly requestReads: number;
  /** Every problem found, with its seed (first 20). */
  readonly problems: readonly string[];
}

/** Runs `count` random sessions against one model and sums them up. */
export async function runModelSessions(model: ModelName, count: number): Promise<ModelRun> {
  let connected = 0;
  let enqWritten = 0;
  let feedholdWritten = 0;
  let requestReads = 0;
  const problems: string[] = [];
  for (let seed = 1; seed <= count; seed++) {
    const v = await randomSession(seed, model);
    if (v.reachedConnected) connected++;
    enqWritten += v.enqWritten;
    feedholdWritten += v.feedholdWritten;
    requestReads += v.requestReads;
    for (const p of v.problems) if (problems.length < 20) problems.push(`seed ${seed}: ${p}`);
  }
  return { sessions: count, connected, enqWritten, feedholdWritten, requestReads, problems };
}

const between = (rng: SeededRng, lo: number, hi: number): number => lo + rng.int(hi - lo + 1);
const pick = <T>(rng: SeededRng, items: readonly T[]): T => items[rng.int(items.length)] as T;

function dialectFor(model: ModelName): DialectId {
  return model === 'en' ? 'tinyg-en' : 'tinyg-440';
}

function randomFaults(rng: SeededRng): Fault[] {
  const faults: Fault[] = [];
  const roll = rng.next();
  if (roll < 0.12) faults.push({ kind: 'boardReset', atMs: between(rng, 0, 600) });
  else if (roll < 0.22) faults.push({ kind: 'xoffBurst', atMs: between(rng, 0, 400), holdMs: between(rng, 1, 300), repeat: between(rng, 1, 3), everyMs: 350 });
  else if (roll < 0.3) faults.push({ kind: 'disconnect', direction: 'toHost', atByte: between(rng, 0, 2000) });
  else if (roll < 0.38) faults.push({ kind: 'corrupt', direction: 'toHost', select: { probability: 0.002 } });
  else if (roll < 0.44) faults.push({ kind: 'drop', direction: 'toHost', select: { probability: 0.002 } });
  else if (roll < 0.48) faults.push({ kind: 'duplicate', direction: 'toHost', select: { probability: 0.002 } });
  else if (roll < 0.52) faults.push({ kind: 'latency', direction: 'toHost', fromMs: 0, toMs: 400, extraMs: between(rng, 100, 3500) });
  else if (roll < 0.55) faults.push({ kind: 'bannerDelay', extraMs: between(rng, 100, 2500) });
  return faults;
}

/** Runs one random session and checks every write it made. */
export async function randomSession(seed: number, model: ModelName): Promise<SessionVerdict> {
  const rng = new SeededRng(seed);
  const dialect = dialectFor(model);
  const h = harness(model, {
    device: { start: rng.next() < 0.3 ? 'boot' : 'ready', bootMs: between(rng, 10, 400) },
    faults: { faults: randomFaults(rng) },
    seed,
    session: { timings: { firstAnswerMs: 3000, probeAnswerMs: 3000, readAnswerMs: 2000 } },
  });
  let reachedConnected = false;
  void h.session.connect(PORT);
  const steps = between(rng, 2, 10);
  for (let i = 0; i < steps; i++) {
    await h.run(between(rng, 0, 400));
    if (h.session.snapshot.base === 'CONNECTED_UNKNOWN') reachedConnected = true;
    const roll = rng.next();
    if (roll < 0.12) h.session.feedhold();
    else if (roll < 0.17) h.session.stopJob();
    else if (roll < 0.2) h.session.spindleOffNow();
    else if (roll < 0.35) h.session.enq();
    else if (roll < 0.55) h.session.read(Array.from({ length: between(rng, 1, 4) }, () => pick(rng, READ_POOL)));
    else if (roll < 0.6) h.session.ackFault();
    else if (roll < 0.66) void h.session.disconnect();
    else if (roll < 0.7) h.session.acknowledgeLost();
    else if (roll < 0.75) void h.session.connect(PORT);
    else if (roll < 0.83) h.session.request({ intent: pick(rng, OTHER_INTENTS) } as never);
    else if (roll < 0.86) h.device.resetBoard();
    else if (roll < 0.88) {
      if (h.endpoint.connected) h.endpoint.disconnect('test: unplugged');
    }
    else if (roll < 0.9) h.device.setReportSuppression(rng.next() < 0.5);
  }
  await h.run(between(rng, 0, 3500));
  if (h.session.snapshot.base === 'CONNECTED_UNKNOWN') reachedConnected = true;
  const problems = h.transports.flatMap((t, i) => checkConnection(t.events, dialect, model).map((p) => `connection ${i}: ${p}`));
  const all = h.transports.flatMap((t) => t.writes);
  const probeOrReading = new Set([...PROBE_TOKENS, 'stat', 'hold', 'vel', 'qr']);
  return {
    seed,
    model,
    problems,
    reachedConnected,
    writes: all.length,
    enqWritten: all.filter((w) => w.length === 1 && w[0] === 0x05).length,
    feedholdWritten: all.filter((w) => w.length === 1 && w[0] === 0x21).length,
    requestReads: all.filter((w) => {
      const m = /^\{"([^"]*)":null\}\n$/.exec(new TextDecoder().decode(w));
      return m !== null && !probeOrReading.has(m[1] as string);
    }).length,
  };
}

/**
 * Checks one connection's writes, in order with what it had read before
 * each one (SimTransport.events): the first line is `{"sr":null}` (T-S86,
 * H49); every line is a single-token GET of a probe token or a token on the
 * board's read allowlist, never one of the side-effect tokens (T-S38); the
 * only realtime bytes are `!` and ENQ; ENQ only on edge-next, and only after
 * a revision 2/3 footer was received (T-S24b, T-S87). No 0x18, no 0x04
 * (T-S26, T-S24a).
 */
export function checkConnection(events: readonly { readonly dir: 'w' | 'r'; readonly bytes: Uint8Array }[], dialect: DialectId, model: ModelName): string[] {
  const problems: string[] = [];
  const decoder = createInboundDecoder();
  let rev23Seen = false;
  let first = true;
  for (const { dir, bytes } of events) {
    if (dir === 'r') {
      for (const event of decoder.push(bytes)) if (event.kind === 'Response' && (event.footer.rev === 2 || event.footer.rev === 3)) rev23Seen = true;
      continue;
    }
    const text = shown(bytes);
    if (bytes.length === 1) {
      const b = bytes[0] as number;
      if (b === 0x21) continue;
      if (b === 0x05) {
        if (model !== 'en') problems.push('ENQ written to a TinyG 440.21 board');
        else if (!rev23Seen) problems.push('ENQ written before a revision 2/3 footer');
        continue;
      }
      problems.push(`realtime byte ${text} written`);
      continue;
    }
    const match = /^\{"([^"]*)":null\}\n$/.exec(new TextDecoder().decode(bytes));
    if (match === null) {
      problems.push(`not a GET: ${text}`);
      continue;
    }
    const token = match[1] as string;
    if (first && token !== 'sr') problems.push(`the first line written is ${text}, not {"sr":null}`);
    first = false;
    if (NEVER_READ.includes(token)) problems.push(`forbidden GET ${text}`);
    if (!PROBE_TOKENS.has(token) && !isReadAllowed(dialect, token)) problems.push(`GET of a token outside the probe list and the ${dialect} allowlist: ${text}`);
  }
  if (first && events.some((e) => e.dir === 'w')) problems.push('realtime bytes but no line: impossible before the probe');
  return problems;
}
