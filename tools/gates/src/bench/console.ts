/**
 * The bench server's console route: the bench page posts its wire transcript
 * (the worker's `{t, dir, text}` JSONL, the same lines the Console tab shows)
 * and anyone on this computer reads it back as text, so a session's traffic
 * can be read without the browser (owner request, 2026-11-03).
 *
 * - `POST /console` with the JSONL as the body replaces what is held (the
 *   page posts the whole transcript whenever it changes; the worker bounds
 *   it). Bodies over `MAX_CONSOLE_BYTES` are refused (413).
 * - `GET /console` answers the transcript rendered one line per entry:
 *   `<seconds since the first entry> <→ sent | ← received | · note> <text>`.
 *   `GET /console?raw` answers the JSONL as posted.
 * - Bench only, loopback only, held in memory: nothing is written to disk.
 */

export const MAX_CONSOLE_BYTES = 16 * 1024 * 1024;

export interface ConsoleEntry {
  readonly t: number;
  readonly dir: 'tx' | 'rx' | 'note';
  readonly text: string;
}

const ARROW: Readonly<Record<ConsoleEntry['dir'], string>> = { tx: '→', rx: '←', note: '·' };

/** Parses one transcript line; anything that is not an entry is skipped. */
export function parseConsoleLine(line: string): ConsoleEntry | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const t = o['t'];
  const dir = o['dir'];
  const text = o['text'];
  if (typeof t !== 'number' || !Number.isFinite(t) || typeof text !== 'string') return null;
  if (dir !== 'tx' && dir !== 'rx' && dir !== 'note') return null;
  return { t, dir, text };
}

/** The transcript as the Console tab shows it: seconds from the first entry, the direction, the text. */
export function renderConsole(jsonl: string): string {
  const entries = jsonl
    .split('\n')
    .filter((l) => l.length > 0)
    .map(parseConsoleLine)
    .filter((e): e is ConsoleEntry => e !== null);
  if (entries.length === 0) return '';
  const t0 = (entries[0] as ConsoleEntry).t;
  return `${entries.map((e) => `${((e.t - t0) / 1000).toFixed(3).padStart(9)} ${ARROW[e.dir]} ${e.text}`).join('\n')}\n`;
}

/** What the page last posted. */
export class BenchConsole {
  #jsonl = '';
  #receivedAt: number | null = null;
  readonly #now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  put(jsonl: string): void {
    this.#jsonl = jsonl;
    this.#receivedAt = this.#now();
  }

  get raw(): string {
    return this.#jsonl;
  }

  /** When the page last posted, as an ISO date, or null before the first post. */
  get receivedAt(): string | null {
    return this.#receivedAt === null ? null : new Date(this.#receivedAt).toISOString();
  }

  text(): string {
    return renderConsole(this.#jsonl);
  }
}

export function isConsolePath(path: string): boolean {
  return path === '/console';
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

export interface ConsoleAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/** Answers a `/console` request. The caller has already checked the Host header. */
export function consoleRespond(console: BenchConsole, method: string, target: string, body: Uint8Array | undefined): ConsoleAnswer {
  const headers: Record<string, string> = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };
  if (method === 'POST') {
    if (body === undefined) return { status: 400, headers, body: enc.encode('a POST to /console needs the transcript as its body\n') };
    if (body.byteLength > MAX_CONSOLE_BYTES) return { status: 413, headers, body: enc.encode(`the transcript may be at most ${MAX_CONSOLE_BYTES} bytes\n`) };
    console.put(dec.decode(body));
    return { status: 204, headers, body: new Uint8Array() };
  }
  if (method !== 'GET' && method !== 'HEAD') return { status: 405, headers: { ...headers, allow: 'GET, HEAD, POST' }, body: enc.encode('GET, HEAD and POST only\n') };
  const raw = /[?&]raw(?:[=&]|$)/.test(target.slice(target.indexOf('?')));
  const received = console.receivedAt;
  const text = received === null ? '' : raw ? console.raw : console.text();
  const out = received === null ? 'no transcript yet: the bench page posts it once a link has opened\n' : text;
  return {
    status: 200,
    headers: { ...headers, ...(received === null ? {} : { 'x-console-received-at': received }) },
    body: method === 'HEAD' ? new Uint8Array() : enc.encode(out),
  };
}
