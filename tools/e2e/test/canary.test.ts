/**
 * The canary must not pass vacuously (ROADMAP P0-06: "A third-party URL in a
 * built page fails the job").
 */
import { describe, expect, it } from 'vitest';
import { INJECTIONS, inject, judgeCanary, type JsonReport } from '../src/canary.ts';
import { classifyUrl, GUARD_PREFIX } from '../src/origin.ts';
import { REQUIRED_SITE_FILES } from '../src/served.ts';

const MARKERS = INJECTIONS.map((i) => i.marker);

function report(messages: readonly string[], stats = { expected: 30, unexpected: messages.length }, errors: { message: string }[] = []): JsonReport {
  return {
    errors,
    stats,
    suites: [{ suites: [{ specs: [{ title: 't', tests: [{ results: messages.map((m) => ({ status: 'failed', errors: [{ message: m }] })) }] }] }] }],
  };
}

const ALL_CAUGHT = MARKERS.map((m) => `Error: ${GUARD_PREFIX} 1 finding(s); ...\n  dom ${m} (<x> in /)`);

describe('INJECTIONS', () => {
  it('plants one distinct third-party URL in each built page the suite visits', () => {
    expect(INJECTIONS.map((i) => i.page).sort()).toEqual(['404.html', 'index.html', 'privacy/index.html', 'safety/index.html']);
    for (const i of INJECTIONS) {
      expect(REQUIRED_SITE_FILES).toContain(i.page);
      expect(i.html).toContain(i.marker);
      expect(classifyUrl(i.marker, 'http://127.0.0.1:8790')).toBe('external');
      expect(new URL(i.marker).hostname.endsWith('.invalid')).toBe(true);
    }
    expect(new Set(MARKERS).size).toBe(MARKERS.length);
  });
});

describe('inject', () => {
  const page = INJECTIONS[0];
  if (page === undefined) throw new Error('no injections');
  it('inserts before the single anchor', () => {
    expect(inject('<html><body><p>x</p></body></html>', page)).toBe(`<html><body><p>x</p>${page.html}</body></html>`);
  });
  it('refuses a page without exactly one anchor', () => {
    expect(() => inject('<html></html>', page)).toThrow(/exactly once/);
    expect(() => inject('<body></body></body>', page)).toThrow(/exactly once/);
  });
});

describe('judgeCanary', () => {
  it('is ok only when the suite failed and the guard named every planted URL', () => {
    expect(judgeCanary(1, report(ALL_CAUGHT), MARKERS)).toEqual({ ok: true, problems: [] });
  });

  it('fails when the suite passed', () => {
    const verdict = judgeCanary(0, report([], { expected: 40, unexpected: 0 }), MARKERS);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toContain('the suite PASSED with third-party URLs planted in the built pages');
  });

  it('fails when one planted URL was never reported by the guard', () => {
    const verdict = judgeCanary(1, report(ALL_CAUGHT.slice(1)), MARKERS);
    expect(verdict.problems).toEqual([`the origin guard never reported ${MARKERS[0] ?? ''}`]);
  });

  it('does not count a marker that appears only in a non-guard failure', () => {
    const verdict = judgeCanary(1, report([`expect(received).toBe(expected) ${MARKERS.join(' ')}`]), MARKERS);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toContain(`no failure came from the origin guard ("${GUARD_PREFIX}")`);
  });

  it('fails on a run that broke before testing anything (global error)', () => {
    const verdict = judgeCanary(1, report([], { expected: 0, unexpected: 0 }, [{ message: 'Error: Timed out waiting 60000ms from config.webServer.' }]), MARKERS);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.some((p) => p.startsWith('the run had global errors'))).toBe(true);
    expect(verdict.problems).toContain('no test failed');
  });

  it('reads guard messages through ANSI colour codes', () => {
    const esc = String.fromCharCode(27);
    const coloured = ALL_CAUGHT.map((m) => `${esc}[31m${m}${esc}[39m`);
    expect(judgeCanary(1, report(coloured), MARKERS).ok).toBe(true);
  });
});
