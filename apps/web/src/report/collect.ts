/**
 * What a problem report collects (REPORT_A_PROBLEM §4). Pure: every function
 * takes what run already holds (the session snapshot, the transcript text
 * the worker keeps, the settings already read, the loaded file) and returns
 * text. Nothing here asks the board for anything: reporting sends no command
 * and never touches the connection (§1 principle 2).
 *
 * Every text that can carry the board id goes through `redactText` before it
 * is returned, so the preview is what would be posted.
 */
import { D440, D449, DEN, type GeneratedTable } from '@synthetos/schema';
import type { WorkerStatus } from '../machine-worker/rpc.ts';
import { redactText, redactValue } from './redact.ts';

type SessionSnapshot = WorkerStatus['session'];

/** How many transcript lines a report carries (§4: "the last 200 lines around the event"). */
export const TRANSCRIPT_LINES = 200;
/** Lines on each side of the problem line in the G-code excerpt (§4). */
export const EXCERPT_RADIUS = 25;

// ---------------------------------------------------------------- environment

/** The browser and OS family with the browser's major version only: never the full user-agent string. */
export function browserFamily(userAgent: string): string {
  const ua = userAgent;
  const pick = (re: RegExp): string | null => re.exec(ua)?.[1] ?? null;
  const edge = pick(/Edg\/(\d+)/);
  const opera = pick(/OPR\/(\d+)/);
  const chrome = pick(/Chrome\/(\d+)/);
  const firefox = pick(/Firefox\/(\d+)/);
  const safari = /Safari\//.test(ua) ? pick(/Version\/(\d+)/) : null;
  const browser = edge !== null ? `Edge ${edge}` : opera !== null ? `Opera ${opera}` : chrome !== null ? `Chrome ${chrome}` : firefox !== null ? `Firefox ${firefox}` : safari !== null ? `Safari ${safari}` : 'Unknown browser';
  const os = /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}

export interface EnvironmentInput {
  readonly version: string;
  readonly sha: string;
  readonly channel: 'release' | 'bench';
  readonly userAgent: string;
  readonly view: string;
  readonly snapshot: Pick<SessionSnapshot, 'base' | 'overlays'> | null;
}

export function environmentText(e: EnvironmentInput): string {
  const s = e.snapshot;
  return [
    `run version: ${e.version}`,
    `commit: ${e.sha}`,
    `build channel: ${e.channel}`,
    `browser: ${browserFamily(e.userAgent)}`,
    `view: ${e.view}`,
    `session: ${s === null ? 'no board connected' : `${s.base}${s.overlays.length === 0 ? '' : ` (${s.overlays.join(', ')})`}`}`,
  ].join('\n');
}

// ---------------------------------------------------------------- board

const PINS: Readonly<Record<string, { readonly branch: string; readonly table: GeneratedTable }>> = {
  'tinyg-en': { branch: 'edge-next', table: DEN },
  'tinyg-440': { branch: 'master 440.xx', table: D440 },
  'tinyg-449-stock': { branch: 'edge-0.97', table: D449 },
};

const DIALECT_NAME: Readonly<Record<string, string>> = { 'tinyg-en': 'TinyG edge-next', 'tinyg-440': 'TinyG 440', 'tinyg-449-stock': 'TinyG 449 (stock)' };

/** "fb 450.01, matches run's edge-next pin 93a723b8", or why it does not. */
export function pinText(dialectId: string | null | undefined, fb: number | undefined): string {
  const pin = typeof dialectId === 'string' ? PINS[dialectId] : undefined;
  const reported = typeof fb === 'number' && Number.isFinite(fb) ? `fb ${fb.toFixed(2)}` : 'fb not reported';
  if (pin === undefined) return `${reported}; run has no pinned build for this dialect`;
  const short = pin.table.commit.slice(0, 8);
  if (typeof fb !== 'number') return `${reported}; run's ${pin.branch} pin is ${short} (fb ${pin.table.fb.toFixed(2)})`;
  return fb === pin.table.fb ? `${reported}, matches run's ${pin.branch} pin ${short}` : `${reported}, differs from run's ${pin.branch} pin ${short} (fb ${pin.table.fb.toFixed(2)})`;
}

export function boardText(s: Pick<SessionSnapshot, 'identity' | 'classification'> | null): string | null {
  if (s === null || (s.identity === null && s.classification === null)) return null;
  const id = s.identity ?? {};
  const c = s.classification;
  const dialect = c?.dialectId ?? null;
  const lines = [
    `board id: ${typeof id.id === 'string' && id.id.length > 0 ? id.id : 'not reported'}`,
    `firmware build: ${pinText(dialect, id.fb)}`,
    `firmware version (fv): ${id.fv ?? 'not reported'}`,
    `hardware platform (hp): ${id.hp ?? 'not reported'}`,
    `hardware version (hv): ${id.hv ?? 'not reported'}`,
    ...(id.fbs === undefined ? [] : [`build identity (fbs): ${id.fbs}`]),
    `dialect: ${dialect === null ? 'not identified' : `${DIALECT_NAME[dialect] ?? dialect} (${dialect})`}`,
    `approval: ${c === null ? 'not classified' : `${c.mode === 'full' ? 'full' : 'read only'}, ${c.reason}`}`,
  ];
  return redactText(lines.join('\n'), [id.id]);
}

// ---------------------------------------------------------------- event

/** What started the report from a notice: the code, its words, the state at the time, the line. */
export interface ReportEvent {
  readonly code: string;
  readonly message: string;
  readonly state?: string;
  readonly overlays?: readonly string[];
  readonly line?: number | null;
  readonly stat?: number | null;
}

export function eventText(e: ReportEvent, ids: readonly (string | undefined)[] = []): string {
  const lines = [`code: ${e.code}`, `message: ${e.message}`];
  if (e.state !== undefined) lines.push(`state: ${e.state}${e.overlays === undefined || e.overlays.length === 0 ? '' : ` (${e.overlays.join(', ')})`}`);
  if (e.stat !== undefined && e.stat !== null) lines.push(`stat: ${e.stat}`);
  if (e.line !== undefined && e.line !== null) lines.push(`line being executed: ${e.line}`);
  return redactText(lines.join('\n'), ids);
}

// ---------------------------------------------------------------- transcript

function hexText(hex: string): string {
  let s = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const c = Number.parseInt(hex.slice(i, i + 2), 16);
    s += c === 10 || c === 13 ? '' : c < 32 || c === 127 ? `\\x${hex.slice(i, i + 2)}` : String.fromCharCode(c);
  }
  return s;
}

/**
 * The last `max` lines of the worker's wire transcript (`{t, dir, hex}` JSONL) as readable text,
 * `+12.345 → {"sr":null}`, with the board id redacted. Damaged rows are skipped.
 */
export function transcriptExcerpt(jsonl: string, ids: readonly (string | undefined)[] = [], max = TRANSCRIPT_LINES): { readonly text: string; readonly lines: number; readonly total: number } {
  const rows = jsonl.trim() === '' ? [] : jsonl.trim().split('\n');
  const parsed: { t: number; dir: string; text: string }[] = [];
  for (const row of rows) {
    try {
      const e = JSON.parse(row) as { t?: unknown; dir?: unknown; hex?: unknown };
      if (typeof e.t === 'number' && typeof e.dir === 'string' && typeof e.hex === 'string') parsed.push({ t: e.t, dir: e.dir, text: hexText(e.hex) });
    } catch {
      // A damaged row is skipped.
    }
  }
  const tail = parsed.slice(-max);
  const t0 = tail[0]?.t ?? 0;
  const text = tail.map((l) => `+${((l.t - t0) / 1000).toFixed(3)} ${l.dir === 'tx' ? '→' : '←'} ${l.text}`).join('\n');
  return { text: redactText(text, ids), lines: tail.length, total: parsed.length };
}

// ---------------------------------------------------------------- settings

/** The settings already read, as backup-format JSON, id redacted. Null when none were read. */
export function settingsJson(settings: Readonly<Record<string, unknown>>, ids: readonly (string | undefined)[] = []): string | null {
  const keys = Object.keys(settings).sort();
  if (keys.length === 0) return null;
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = settings[k];
  return JSON.stringify(redactValue({ format: 'synthetos-run-settings-backup', version: 1, reason: 'report', tokens: sorted }, ids), null, 2);
}

// ---------------------------------------------------------------- G-code

export interface GcodeExcerpt {
  /** 1-based first and last line shown. */
  readonly from: number;
  readonly to: number;
  readonly total: number;
  /** The problem line, or null when none was named. */
  readonly line: number | null;
  readonly text: string;
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\n\r|\r|\n/);
  if (lines.length > 0 && lines.at(-1) === '') lines.pop();
  return lines;
}

/** Lines `line - radius` to `line + radius` (clamped), numbered. Without a line, the first `2·radius + 1`. */
export function gcodeExcerpt(text: string, line: number | null, radius = EXCERPT_RADIUS): GcodeExcerpt {
  const lines = splitLines(text);
  const total = lines.length;
  const at = line === null || !Number.isFinite(line) ? null : Math.min(Math.max(1, Math.round(line)), Math.max(1, total));
  const from = at === null ? 1 : Math.max(1, at - radius);
  const to = Math.min(total, at === null ? radius * 2 + 1 : at + radius);
  const width = String(to).length;
  const shown = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(width, ' ')}${from + i === at ? '>' : ' '} ${l}`);
  return { from, to, total, line: at, text: shown.join('\n') };
}

/** Every comment in `text` (parenthesised and `;`), trimmed and de-duplicated: they may name customers or parts. */
export function gcodeComments(text: string, limit = 40): readonly string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\(([^)\r\n]*)\)|;([^\r\n]*)/g)) {
    const c = (m[1] ?? m[2] ?? '').trim();
    if (c === '' || seen.has(c)) continue;
    seen.add(c);
    found.push(c);
    if (found.length >= limit) break;
  }
  return found;
}

/** Bytes as text, one byte per character (Latin-1), as the sanitiser reads a file. */
export function latin1Text(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000))));
  return parts.join('');
}
