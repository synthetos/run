/**
 * The Phase 1 write gate and the read paths (ROADMAP P1-02): T-S38 (fuzz
 * every read path over all dialects: no token outside the allowlist is
 * emitted; the side-effect tokens never are), T-S24a/b and T-S26 at the
 * byte level, and T-S39 (only `MachineSession` writes to the transport).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BYTE, PROBE_STEPS, SPLICE_GUARD_LINE } from '@synthetos/protocol';
import { READ_ALLOWLISTS, isReadAllowed } from '@synthetos/schema';
import { PROBE_TOKENS, phase1WriteVerdict } from '../src/index.ts';
import { Driver, EN_ANSWERS, TG_ANSWERS } from './sessionDriver.ts';
import { NEVER_READ } from './sessionModel.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const ANY = { readable: (): boolean => true, enqAllowed: true };

describe('phase1WriteVerdict', () => {
  it('accepts the bare-key splice guard {sr:null} exactly, only while sr is readable; no other bare key', () => {
    expect(phase1WriteVerdict(enc('{sr:null}\n'), ANY)).toEqual({ ok: true, kind: 'get', token: 'sr' });
    expect(phase1WriteVerdict(enc('{sr:null}\n'), { readable: () => false, enqAllowed: false })).toMatchObject({ ok: false });
    for (const line of ['{fb:null}\n', '{sr:n}\n', '{SR:null}\n', '{ sr:null}\n']) expect(phase1WriteVerdict(enc(line), ANY), line).toMatchObject({ ok: false });
  });

  it('passes `{"<token>":null}` LF for a readable token, ! and an allowed ENQ, and nothing else of one byte', () => {
    expect(phase1WriteVerdict(enc('{"posx":null}\n'), ANY)).toEqual({ ok: true, kind: 'get', token: 'posx' });
    expect(phase1WriteVerdict(enc('{"_cs1":null}\n'), ANY)).toMatchObject({ ok: true, token: '_cs1' });
    expect(phase1WriteVerdict(enc('{"1ma":null}\n'), ANY)).toMatchObject({ ok: true, token: '1ma' });
    expect(phase1WriteVerdict(Uint8Array.of(BYTE.FEEDHOLD), ANY)).toEqual({ ok: true, kind: 'feedhold' });
    expect(phase1WriteVerdict(Uint8Array.of(BYTE.ENQ), ANY)).toEqual({ ok: true, kind: 'enq' });
    expect(phase1WriteVerdict(Uint8Array.of(BYTE.ENQ), { ...ANY, enqAllowed: false })).toMatchObject({ ok: false });
    for (let b = 0; b < 256; b++) {
      if (b === BYTE.FEEDHOLD || b === BYTE.ENQ) continue;
      expect(phase1WriteVerdict(Uint8Array.of(b), ANY).ok, `0x${b.toString(16)}`).toBe(false);
    }
  });

  it('never passes ^X (0x18), ^D (0x04), %, ~ or any of them inside a line (T-S26, T-S24a)', () => {
    for (const b of [BYTE.RESET, BYTE.KILL, BYTE.FLUSH, BYTE.RESUME, BYTE.XON, BYTE.XOFF]) {
      expect(phase1WriteVerdict(Uint8Array.of(b), ANY).ok).toBe(false);
      expect(phase1WriteVerdict(Uint8Array.of(BYTE.FEEDHOLD, b), ANY).ok).toBe(false);
      expect(phase1WriteVerdict(enc(`{"posx":null}${String.fromCharCode(b)}\n`), ANY).ok).toBe(false);
    }
  });

  it.each([
    ['G-code', 'G0 X10\n'],
    ['a SET', '{"xvm":1000}\n'],
    ['two keys', '{"posx":null,"md":null}\n'],
    ['a space', '{"posx": null}\n'],
    ['no LF', '{"posx":null}'],
    ['CR LF', '{"posx":null}\r\n'],
    ['an uppercase key', '{"POSX":null}\n'],
    ['a long key', '{"abcdefghi":null}\n'],
    ['an empty key', '{"":null}\n'],
    ['non-ASCII', '{"pösx":null}\n'],
    ['a tab', '{"posx":\tnull}\n'],
    ['nothing', ''],
    ['a long line', `{"posx":null}${' '.repeat(40)}\n`],
    ['a $ command', '$md\n'],
  ])('refuses %s', (_label, text) => {
    expect(phase1WriteVerdict(enc(text), ANY).ok).toBe(false);
  });

  it('refuses a well-formed GET of a token that is not readable now', () => {
    expect(phase1WriteVerdict(enc('{"md":null}\n'), { readable: (t) => t !== 'md', enqAllowed: false })).toMatchObject({ ok: false, reason: expect.stringContaining('"md"') });
  });

  it('any bytes at all: passes only the three shapes (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 40 }), (bytes) => {
        const v = phase1WriteVerdict(bytes, ANY);
        if (!v.ok) return;
        if (v.kind === 'feedhold') expect([...bytes]).toEqual([BYTE.FEEDHOLD]);
        else if (v.kind === 'enq') expect([...bytes]).toEqual([BYTE.ENQ]);
        else expect(new TextDecoder().decode(bytes)).toBe(`{"${v.token}":null}\n`);
      }),
      { numRuns: 5000 },
    );
  });
});

describe('T-S38: fuzz the read paths over all dialects', () => {
  it('the probe (before classification) reads only its own tokens, none with side effects', () => {
    for (const step of PROBE_STEPS) {
      expect(step.line).toBe(step.stage === 'spliceGuard' ? SPLICE_GUARD_LINE : `{"${step.key}":null}`);
      expect(NEVER_READ).not.toContain(step.key);
    }
    // Every probe token except fbs (no TinyG build has it; it answers 100) is on the edge-next allowlist.
    for (const token of PROBE_TOKENS) if (token !== 'fbs') expect(isReadAllowed('tinyg-en', token), token).toBe(true);
  });

  it.each([
    ['tinyg-en', EN_ANSWERS],
    ['tinyg-440', TG_ANSWERS],
  ])('read requests on %s: whatever is asked, only allowlisted single-token GETs are written', (dialect, answers) => {
    const tokenArb = fc.oneof(
      fc.constantFrom(...NEVER_READ, ...[...READ_ALLOWLISTS[dialect as 'tinyg-en'].allow].slice(0, 60), 'jogz', 'jog1', 'joga', 'boot1'),
      fc.string({ maxLength: 10 }),
      fc.string({ unit: fc.constantFrom('a', 'd', 'm', 'x', '"', ':', ',', '{', '}', '\n', '\u0018', '\u0004', ' ', '1', '_'), maxLength: 12 }),
    );
    fc.assert(
      fc.property(fc.array(fc.array(tokenArb, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 6 }), (requests) => {
        const d = new Driver();
        d.open();
        d.answer(answers);
        const before = d.lines().length;
        for (const tokens of requests) {
          d.intent({ intent: 'read', tokens });
          // Answer whatever was written with an empty OK, so the next read can go.
          for (let i = 0; i < 70 && d.writing !== undefined; i++) {
            d.written();
            d.line(dialect === 'tinyg-en' ? '{"r":{},"f":[3,0,10]}' : (TG_ANSWERS.fbs as string).replace(',100,', ',0,'));
          }
        }
        for (const line of d.lines().slice(before)) {
          const m = /^\{"?([^":]+)"?:null\}$/.exec(line);
          expect(m, line).not.toBeNull();
          const token = (m as RegExpExecArray)[1] as string;
          expect(isReadAllowed(dialect, token), line).toBe(true);
          expect(NEVER_READ.includes(token) || token.startsWith('jog'), line).toBe(false);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('an unclassified session (no allowlist: g2core, stock builds not identified) reads nothing after the probe', () => {
    const d = new Driver();
    d.open();
    d.answer({ ...EN_ANSWERS, hp: '{"r":{"hp":"g2core"},"f":[3,0,10]}' });
    expect(d.state.classification?.dialectId).toBeNull();
    expect(d.intent({ intent: 'read', tokens: ['posx'] }).allowed).toBe(false);
    expect(d.lines()).toEqual(PROBE_STEPS.map((s) => s.line));
  });
});

describe('T-S39: only MachineSession writes to the transport', () => {
  const repo = join(import.meta.dirname, '..', '..', '..');
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (name === 'node_modules' || name.startsWith('dist')) continue;
      if (statSync(path).isDirectory()) out.push(...sources(path));
      else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
    }
    return out;
  }

  it('no production source outside the transport layer and the session calls writeLine', () => {
    const roots = ['packages', 'apps', 'workers'].map((r) => join(repo, r));
    const callers = roots
      .flatMap(sources)
      .filter((p) => /\/src\//.test(p) && !/\/packages\/testkit\//.test(p))
      .filter((p) => /\.writeLine\(/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(repo, p))
      .sort();
    // guardedTransport forwards to the inner transport; the session is the one caller above it. The bootloader link
    // (SAFETY §4.8 as amended 2026-11-03) is the port in bootloader role: it writes only frames the flasher's frame
    // guard admits, and opens only with the flasher's capability.
    // flashService's checked transport (proposed H92) only forwards the session's writes unchanged; it originates
    // none. It wraps the port to re-check the bootloader quarantine when the session opens it.
    expect(callers).toEqual(['apps/web/src/machine-worker/flashService.ts', 'packages/machine/src/bootloaderLink.ts', 'packages/machine/src/guardedTransport.ts', 'packages/machine/src/session/machineSession.ts']);
  });

  it('the web app reaches the machine only through the worker: no page or panel module imports the transport layer', () => {
    const app = sources(join(repo, 'apps', 'web', 'src')).filter((p) => !p.includes(`${join('src', 'machine-worker')}`));
    const importers = app.filter((p) => /from '@synthetos\/machine/.test(readFileSync(p, 'utf8'))).map((p) => relative(repo, p));
    // OD-3: the one exception is the window's port chooser module, which imports only the chooser
    // subpath (it shows Chrome's chooser and never opens a port).
    expect(importers).toEqual(['apps/web/src/live/portChooser.ts']);
    const imports = [...readFileSync(join(repo, 'apps/web/src/live/portChooser.ts'), 'utf8').matchAll(/from '(@synthetos\/machine[^']*)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['@synthetos/machine/web-serial-chooser']);
  });
});
