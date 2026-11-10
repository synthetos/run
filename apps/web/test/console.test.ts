/**
 * The Console command line (WORKSPACE_FEATURES "Console command line"): the
 * translator (always JSON on the wire; Phase 1 sends allowlisted reads only;
 * motion and writes are shown and never sent; text-mode and realtime commands
 * mapped or refused), completion and plain-words replies, and the console
 * read (one GET through the worker's read path, never while a job streams).
 */
import { describe, expect, it } from 'vitest';
import { readDecisionFor } from '@synthetos/schema';
import { JOB_STREAMING, NOT_CLASSIFIED, normaliseGcode, REALTIME_REFUSED, translate, WRITES_LATER, type TranslateContext, type Translation } from '../src/console/translate.ts';
import { complete, completionWord, replyRows, statusText, suggest } from '../src/console/words.ts';
import { ConsoleReader, jobStreaming, rawAnswer, type ConsoleReadDeps } from '../src/live/consoleRead.ts';

const ctx: TranslateContext = { readDecision: (t) => readDecisionFor('tinyg-en', t), jobStreaming: false };
const t = (input: string, c: TranslateContext = ctx): Translation => translate(input, c);
const enc = new TextEncoder();
const hex = (s: string): string => [...enc.encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');

describe('translate: what is typed becomes JSON', () => {
  it('G-code becomes {"gc":…}, normalised; the terminal takes it from there (H91)', () => {
    expect(t('g0x100')).toEqual({ kind: 'motion', wire: '{"gc":"G0X100"}' });
    expect(t('G1 X10 F500')).toEqual({ kind: 'motion', wire: '{"gc":"G1X10F500"}' });
    expect(t('  g1 x-1.5 y.25 (comment) ')).toMatchObject({ kind: 'motion', wire: '{"gc":"G1X-1.5Y.25"}' });
    expect(t('m3 s1000 ; spindle')).toMatchObject({ kind: 'motion', wire: '{"gc":"M3S1000"}' });
    expect(t('G21')).toMatchObject({ kind: 'motion' });
  });

  it('$key and key become a read {"key":null}', () => {
    expect(t('$xvm')).toEqual({ kind: 'read', token: 'xvm', wire: '{"xvm":null}' });
    expect(t('xvm')).toEqual({ kind: 'read', token: 'xvm', wire: '{"xvm":null}' });
    expect(t('  $XVM ')).toEqual({ kind: 'read', token: 'xvm', wire: '{"xvm":null}' });
    expect(t('$1ma')).toMatchObject({ kind: 'read', token: '1ma' });
    expect(t('x')).toMatchObject({ kind: 'read', token: 'x', wire: '{"x":null}' });
    expect(t('$xvm=')).toMatchObject({ kind: 'read', token: 'xvm' });
  });

  it('$key=v becomes a write {"key":v}, shown and never sent in Phase 1', () => {
    expect(t('$xvm=5000')).toEqual({ kind: 'write', wire: '{"xvm":5000}', reason: WRITES_LATER });
    expect(t('xvm = 5000.5')).toEqual({ kind: 'write', wire: '{"xvm":5000.5}', reason: WRITES_LATER });
    expect(t('$1ma=2')).toMatchObject({ kind: 'write', wire: '{"1ma":2}' });
    expect(t('$jv=true')).toMatchObject({ kind: 'write', wire: '{"jv":1}' });
    expect(WRITES_LATER).toBe('Typed settings writes are not sent; change settings in Board → Pending changes');
  });

  it('? becomes a status report read {"sr":null}', () => {
    expect(t('?')).toEqual({ kind: 'read', token: 'sr', wire: '{"sr":null}' });
  });

  it('raw JSON passes only when it parses as one allowlisted read', () => {
    expect(t('{"xvm":null}')).toEqual({ kind: 'read', token: 'xvm', wire: '{"xvm":null}' });
    expect(t('{"sr":""}')).toMatchObject({ kind: 'read', token: 'sr' });
    expect(t('{"xvm":5000}')).toMatchObject({ kind: 'write', wire: '{"xvm":5000}' });
    expect(t('{"gc":"g0 x1"}')).toMatchObject({ kind: 'motion', wire: '{"gc":"G0X1"}' });
    expect(t('{"xvm":null,"yvm":null}')).toMatchObject({ kind: 'refused' });
    expect(t('{"x":{"vm":1}}')).toMatchObject({ kind: 'refused' });
    expect(t('{"xvm":null')).toMatchObject({ kind: 'refused' });
    expect(t('[1]')).toMatchObject({ kind: 'refused' });
    expect(t('{"gc":5}')).toMatchObject({ kind: 'refused' });
    expect(t('{"__proto__":null}')).toMatchObject({ kind: 'refused' });
  });

  it('reads the dialect does not allowlist are refused with the allowlist’s reason', () => {
    const jog = t('$jogx');
    expect(jog.kind).toBe('refused');
    expect(jog.kind === 'refused' ? jog.reason : '').toMatch(/^Not on this board’s read allowlist: /);
    expect(t('{"nosuchtoken":null}')).toMatchObject({ kind: 'refused', wire: '{"nosuchtoken":null}' });
  });

  it('text-mode-only commands are mapped to JSON or refused with an explanation', () => {
    expect(t('$$')).toMatchObject({ kind: 'refused' });
    expect(t('$$').kind === 'refused' && (t('$$') as { reason: string }).reason).toContain('JSON mode');
    expect(t('$h')).toMatchObject({ kind: 'refused' });
    expect(t('$help')).toMatchObject({ kind: 'refused' });
    expect(t('$')).toMatchObject({ kind: 'refused' });
    expect(t('$test')).toMatchObject({ kind: 'refused' });
    expect(t('$defa=1')).toMatchObject({ kind: 'refused' });
    expect(t('$boot=1')).toMatchObject({ kind: 'refused' });
    expect(t('$sr')).toMatchObject({ kind: 'read', token: 'sr', wire: '{"sr":null}' });
    expect(t('$sys')).toMatchObject({ kind: 'read', token: 'sys' });
  });

  it('the realtime characters are refused and point at Pause and Stop job', () => {
    for (const rt of ['!', '~', '%', '^X', '^x', '\u0018', '!!', 'ctrl-x']) expect(t(rt), JSON.stringify(rt)).toEqual({ kind: 'refused', reason: REALTIME_REFUSED });
    expect(REALTIME_REFUSED).toContain('Pause and Stop job');
    expect(t('xvm\u0018')).toEqual({ kind: 'refused', reason: REALTIME_REFUSED });
  });

  it('nothing is sent while a job streams: reads, motion and writes are all refused', () => {
    const streaming = { ...ctx, jobStreaming: true };
    expect(t('?', streaming)).toEqual({ kind: 'refused', reason: JOB_STREAMING, wire: '{"sr":null}' });
    expect(t('$xvm', streaming)).toMatchObject({ kind: 'refused', reason: JOB_STREAMING });
    expect(t('g0x1', streaming)).toMatchObject({ kind: 'refused', reason: JOB_STREAMING });
    expect(t('$xvm=1', streaming)).toMatchObject({ kind: 'refused', reason: JOB_STREAMING });
    expect(t('{"gc":"g0x1"}', streaming)).toMatchObject({ kind: 'refused', reason: JOB_STREAMING });
  });

  it('reads wait for a classified board', () => {
    expect(t('?', { readDecision: null, jobStreaming: false })).toEqual({ kind: 'refused', reason: NOT_CLASSIFIED, wire: '{"sr":null}' });
  });

  it('refuses empty, overlong and unreadable lines', () => {
    expect(t('   ')).toEqual({ kind: 'empty' });
    expect(t('x'.repeat(300))).toMatchObject({ kind: 'refused' });
    expect(t('hello world')).toMatchObject({ kind: 'refused' });
    expect(t('$x-vm')).toMatchObject({ kind: 'refused' });
    expect(t('g0 x')).toMatchObject({ kind: 'refused' });
    expect(normaliseGcode('xvm')).toBeNull();
    expect(normaliseGcode('G0X1')).toBe('G0X1');
  });

  it('only a read can ever be sent: every other kind carries no token', () => {
    const inputs = ['g0x1', '$xvm=1', '!', '$$', '{"gc":"G0"}', '{"a":1}', 'nonsense here'];
    for (const i of inputs) expect(t(i).kind, i).not.toBe('read');
  });
});

describe('completion and plain-words replies', () => {
  it('offers allowlisted tokens with their description, prefix matches first', () => {
    const s = suggest('$xv', 'tinyg-en');
    expect(s[0]?.token).toBe('xvm');
    expect(s[0]?.label).toBe('X maximum velocity');
    expect(suggest('xvm', 'tinyg-en').map((x) => x.token)).toContain('xvm');
    expect(suggest('', 'tinyg-en')).toEqual([]);
    expect(suggest('$xvm=1', 'tinyg-en')).toEqual([]);
    expect(suggest('{"x', 'tinyg-en')).toEqual([]);
    expect(suggest('jogx', 'tinyg-en')).toEqual([]);
  });

  it('completes the word, keeping the $', () => {
    expect(complete('$xv', 'xvm')).toBe('$xvm');
    expect(complete('xv', 'xvm')).toBe('xvm');
    expect(completionWord('g0 x1')).toBeNull();
  });

  it('reads a value back in plain words, a group member by member', () => {
    const one = replyRows('xvm', 16000, 'tinyg-en');
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ key: 'xvm', label: 'X maximum velocity' });
    expect(one[0]?.value).toMatch(/^16 000/);
    const group = replyRows('x', { vm: 16000, fr: 16000 }, 'tinyg-en');
    expect(group.map((r) => r.key)).toEqual(['xvm', 'xfr']);
    const sr = replyRows('sr', { stat: 1, posx: 0 }, 'tinyg-en');
    expect(sr.map((r) => r.key)).toEqual(['stat', 'posx']);
    expect(statusText(0)).toBe('status 0 (OK)');
  });
});

describe('the console read: one allowlisted GET, the answer from the next snapshot', () => {
  type Snap = NonNullable<ReturnType<ConsoleReadDeps['snapshot']>>;
  const snap = (extra: Partial<Snap> = {}): Snap => ({ base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'], epoch: 3, values: {}, ...extra }) as Snap;

  function harness(reply: { ok: boolean; message?: string } = { ok: true }) {
    const reader = new ConsoleReader();
    const sent: string[][] = [];
    let current = snap();
    reader.onSnapshot(current);
    const timers: (() => void)[] = [];
    const deps: ConsoleReadDeps = {
      snapshot: () => current,
      read: (tokens) => {
        sent.push([...tokens]);
        return Promise.resolve({ v: 3, kind: 'read', ...reply } as never);
      },
      transcript: () => Promise.resolve([JSON.stringify({ t: 1, dir: 'rx', hex: hex('{"r":{"xvm":16000},"f":[3,0,4]}\n') })].join('\n')),
      setTimeout: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimeout: () => undefined,
    };
    const answer = (values: Snap['values']): void => {
      current = snap({ values });
      reader.onSnapshot(current);
    };
    return { reader, deps, sent, answer, timers, set: (s: Snap) => { current = s; reader.onSnapshot(s); } };
  }

  it('sends one read and resolves with the value, status and the raw line', async () => {
    const h = harness();
    const p = h.reader.read('xvm', h.deps);
    await Promise.resolve();
    h.answer({ xvm: { value: 16000, status: 0, at: 10 } });
    expect(await p).toEqual({ ok: true, value: 16000, status: 0, raw: '{"r":{"xvm":16000},"f":[3,0,4]}' });
    expect(h.sent).toEqual([['xvm']]);
  });

  it('a refused read reports the allow-matrix reason and remedy', async () => {
    const h = harness({ ok: false, message: 'denied', decision: { allowed: false, reason: 'Not on the list.', remedy: 'Only allowlisted settings can be read.', citation: 'x' } } as never);
    expect(await h.reader.read('jogx', h.deps)).toEqual({ ok: false, message: 'Not on the list. Only allowlisted settings can be read.' });
  });

  it('never sends while a job streams, with no board, or while another read waits', async () => {
    const h = harness();
    h.set(snap({ base: 'RUNNING' as never }));
    expect(jobStreaming({ base: 'RUNNING' } as never)).toBe(true);
    expect((await h.reader.read('xvm', h.deps)).ok).toBe(false);
    h.set(snap({ base: 'NOT_CONNECTED' as never }));
    expect(await h.reader.read('xvm', h.deps)).toEqual({ ok: false, message: 'No board is connected.' });
    expect(h.sent).toEqual([]);
    h.set(snap());
    const first = h.reader.read('xvm', h.deps);
    expect(await h.reader.read('yvm', h.deps)).toEqual({ ok: false, message: 'Wait for the answer to the last read.' });
    await new Promise((r) => setTimeout(r, 0));
    h.timers.forEach((f) => f());
    expect(await first).toMatchObject({ ok: false, message: 'No answer within 5 s.' });
    expect(h.sent).toEqual([['xvm']]);
  });

  it('a link change before the answer is reported, never a stale value', async () => {
    const h = harness();
    const p = h.reader.read('xvm', h.deps);
    await Promise.resolve();
    h.set(snap({ epoch: 4, values: { xvm: { value: 1, status: 0, at: 99 } } }));
    expect(await p).toEqual({ ok: false, message: 'The connection changed before the board answered.' });
  });

  it('rawAnswer finds the last rx line naming the token', () => {
    const jsonl = [JSON.stringify({ t: 1, dir: 'tx', hex: hex('{"xvm":null}\n') }), JSON.stringify({ t: 2, dir: 'rx', hex: hex('{"r":{"xvm":1}}\n') })].join('\n');
    expect(rawAnswer(jsonl, 'xvm')).toBe('{"r":{"xvm":1}}');
    expect(rawAnswer(jsonl, 'yvm')).toBeNull();
    expect(rawAnswer(null, 'xvm')).toBeNull();
  });
});
