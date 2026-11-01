/**
 * The read-only probe (ROADMAP P0-08 acceptance: "Probe steps contain only
 * GETs, each on a single line with a single key"; PN §2.3; SAFETY H49).
 */
import { describe, expect, it } from 'vitest';
import { parseJsonObject } from '../src/json.ts';
import { PROBE_STEPS, buildProbeResult } from '../src/index.ts';
import type { ProbeKey } from '../src/index.ts';
import { EN_450, EN_CAPABILITIES, G2_EDGE, STOCK_449, TG_440, observations, responseLine, tinygIdentity, toBanner, toResponse } from './fixtures/probeFixtures.ts';

/** Tokens that must never be read (E138 side effects, `adc3`, PN §12.3), plus the EN-HIL deny list. */
const NEVER_READ = ['adc3', 'alarm', 'panic', 'shutd', 'me', 'md', 'er', 'boot', 'defa', 'test', 'qf', 'clear', 'clr', 'help', 'h'];

describe('PROBE_STEPS', () => {
  it('writes {"sr":null} first (it spoils a partial line left in the RX ring, H49)', () => {
    expect(PROBE_STEPS[0]).toEqual({ key: 'sr', line: '{"sr":null}', stage: 'spliceGuard' });
  });

  it('every step is a GET: one line, one key, value null', () => {
    for (const step of PROBE_STEPS) {
      expect(step.line, step.key).not.toMatch(/[\r\n\0]/);
      expect(step.line).toMatch(/^[\x20-\x7e]+$/);
      const parsed = parseJsonObject(step.line);
      expect(parsed.ok, step.line).toBe(true);
      if (!parsed.ok) continue;
      expect(Object.keys(parsed.value)).toEqual([step.key]);
      expect(parsed.value[step.key]).toBeNull();
    }
  });

  it('never sends G-code, text-mode commands or realtime bytes: every line starts with {', () => {
    for (const step of PROBE_STEPS) {
      expect(step.line.startsWith('{"'), step.line).toBe(true);
      expect(step.line).not.toMatch(/[!~%$?\x04\x05\x18]/);
    }
  });

  it('never reads adc3 or any token with side effects', () => {
    const keys = PROBE_STEPS.map((s) => s.key as string);
    for (const t of NEVER_READ) expect(keys, t).not.toContain(t);
    expect(keys.some((k) => k.startsWith('jog'))).toBe(false);
  });

  it('reads identity, the build hash, then the four capability tokens, then spph, in PN §2.3 order (plus hv and fbs)', () => {
    expect(PROBE_STEPS.map((s) => s.key)).toEqual(['sr', 'fb', 'fv', 'hp', 'id', 'hv', 'fbs', 'spep', 'prbp', 'fstk', 'os', 'spph']);
  });

  it('is immutable', () => {
    expect(Object.isFrozen(PROBE_STEPS)).toBe(true);
    expect(Object.isFrozen(PROBE_STEPS[1])).toBe(true);
  });
});

describe('buildProbeResult', () => {
  it('edge-next: footer rev 3, identity, all tokens answer, spph stubbed', () => {
    const out = buildProbeResult(EN_450());
    expect(out).toEqual({
      ok: true,
      result: {
        banner: 'none',
        footerRev: 3,
        fb: 450.01,
        fv: 0.97,
        hp: 1,
        hv: 8,
        id: '0BENCH-TWO',
        tokens: { spep: 'value', prbp: 'value', fstk: 'value', os: 'value' },
        spph: 'stubbed',
        // Every answer's footer, in probe order: identity (5), fbs (100), the four tokens, spph (17).
        footers: [0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 17].map((status) => ({ rev: 3, status, field3: 11, raw: [3, status, 11] })),
        conflicts: [],
      },
    });
  });

  it('440.21: footer rev 1, every capability token unrecognised', () => {
    const out = buildProbeResult(TG_440());
    expect(out.ok && out.result).toMatchObject({
      footerRev: 1,
      fb: 440.21,
      tokens: { spep: 'unrecognized', prbp: 'unrecognized', fstk: 'unrecognized', os: 'unrecognized' },
      spph: 'unrecognized',
      conflicts: [],
    });
  });

  it('g2core: string hp/hv, spph is a real setting', () => {
    const out = buildProbeResult(G2_EDGE());
    expect(out.ok && out.result).toMatchObject({ footerRev: 1, hp: 'ArduinoDue', hv: 'na', spph: 'value', conflicts: [] });
  });

  it('records the banner shape and the g2 build hash from the banner', () => {
    const obs = observations({ ...tinygIdentity('450.01'), ...EN_CAPABILITIES }, 3, '{"sr":{"fv":0.97,"fb":450.01,"hp":1,"hv":8,"id":"0BENCH-TWO","msg":"SYSTEM READY"}}');
    const out = buildProbeResult(obs);
    expect(out.ok && out.result.banner).toBe('bare-sr');
    expect(out.ok && out.result.conflicts).toEqual([]);

    const g2 = G2_EDGE();
    const withBanner = { ...g2, banner: toBanner('{"r":{"fv":0.99,"fb":101.06,"fbs":"101.06-2-gabc1234","hp":"ArduinoDue","hv":"na","id":"3X3584-QAM","msg":"SYSTEM READY"},"f":[1,0,12]}') };
    const g2out = buildProbeResult(withBanner);
    expect(g2out.ok && g2out.result).toMatchObject({ banner: 'r-footer', fbs: '101.06-2-gabc1234', conflicts: [] });
  });

  it('fbs comes from the GET, so a board already powered (no banner) that reports one is never "fbs-less"', () => {
    const reporting = observations({ ...tinygIdentity('450.01'), fbs: { body: '"fbs":"450.01-3-g222a45c"', status: 0 }, ...EN_CAPABILITIES }, 3);
    const out = buildProbeResult(reporting);
    expect(out.ok && out.result.fbs).toBe('450.01-3-g222a45c');
    expect(out.ok && out.result.conflicts).toEqual([]);
    // A board without the token answers 100: no fbs, no conflict.
    const none = buildProbeResult(EN_450());
    expect(none.ok && 'fbs' in none.result).toBe(false);
    expect(none.ok && none.result.conflicts).toEqual([]);
  });

  it('the banner fbs and the GET fbs must agree; any answer that is neither a hash nor 100 is a conflict', () => {
    const banner = '{"sr":{"fv":0.97,"fb":450.01,"hp":1,"hv":8,"id":"0BENCH-TWO","fbs":"450.01-3-g222a45c","msg":"SYSTEM READY"}}';
    // Banner says a hash, GET says none.
    const a = buildProbeResult(observations({ ...tinygIdentity('450.01'), ...EN_CAPABILITIES }, 3, banner));
    expect(a.ok && a.result.conflicts.some((c) => c.startsWith('fbs:'))).toBe(true);
    // Banner and GET name different hashes.
    const b = buildProbeResult(observations({ ...tinygIdentity('450.01'), fbs: { body: '"fbs":"other"', status: 0 }, ...EN_CAPABILITIES }, 3, banner));
    expect(b.ok && b.result.conflicts.some((c) => c.startsWith('fbs:'))).toBe(true);
    // A banner with no fbs while the GET reports one.
    const c = buildProbeResult(
      observations({ ...tinygIdentity('450.01'), fbs: { body: '"fbs":"x"', status: 0 }, ...EN_CAPABILITIES }, 3, '{"sr":{"fv":0.97,"fb":450.01,"msg":"SYSTEM READY"}}'),
    );
    expect(c.ok && c.result.conflicts.some((x) => x.startsWith('fbs:'))).toBe(true);
    for (const odd of [{ body: '"fbs":""', status: 0 }, { body: '"fbs":5', status: 0 }, { body: '"fbs":null', status: 17 }]) {
      const d = buildProbeResult(observations({ ...tinygIdentity('450.01'), fbs: odd, ...EN_CAPABILITIES }, 3));
      expect(d.ok && d.result.conflicts.some((x) => x.startsWith('fbs:')), odd.body).toBe(true);
    }
  });

  it('a banner that disagrees with the GET answers is a conflict', () => {
    const obs = observations({ ...tinygIdentity('450.01'), ...EN_CAPABILITIES }, 3, '{"sr":{"fv":0.97,"fb":449.01,"hp":1,"msg":"SYSTEM READY"}}');
    const out = buildProbeResult(obs);
    expect(out.ok && out.result.conflicts).toEqual(['fb: banner says 449.01, GET says 450.01']);
  });

  it('a missing answer cannot be classified (the board stays unclassified)', () => {
    const obs = EN_450();
    const answers = new Map(obs.answers);
    answers.delete('os');
    expect(buildProbeResult({ answers })).toEqual({ ok: false, reason: 'missing-answer', key: 'os' });
  });

  it('a footer revision that changes mid-probe is refused (reset or reconfiguration, SAFETY §3)', () => {
    const obs = EN_450();
    const answers = new Map(obs.answers);
    answers.set('spep', toResponse(responseLine('"spep":1', 0, 2)));
    expect(buildProbeResult({ answers })).toEqual({ ok: false, reason: 'footer-revision-changed', key: 'spep' });
  });

  it('an echoed tid (the probe sends none) is a conflict', () => {
    const answers = new Map(EN_450().answers);
    answers.set('hp', toResponse('{"r":{"hp":1},"tid":9,"f":[3,0,11]}'));
    const out = buildProbeResult({ answers });
    expect(out.ok && out.result.conflicts).toEqual(['hp: unexpected tid']);
  });

  it('an identity error or a wrongly typed identity value is a conflict', () => {
    const cases: [ProbeKey, string, string][] = [
      ['fb', responseLine('"fb":null', 100, 3), 'fb: no value (status 100)'],
      ['fv', responseLine('"fv":"0.97"', 0, 3), 'fv: unexpected type'],
      ['hp', responseLine('"hp":true', 0, 3), 'hp: unexpected type'],
      ['id', responseLine('"id":7', 0, 3), 'id: unexpected type'],
      ['hv', responseLine('"hv":null', 0, 3), 'hv: unexpected type'],
      // An answer carrying another key, or two keys, is not an answer to this GET.
      ['fb', responseLine('"fv":0.97', 0, 3), 'fb: no value (status 0)'],
      ['fb', responseLine('"fb":450.01,"fv":0.97', 0, 3), 'fb: no value (status 0)'],
    ];
    for (const [key, line, conflict] of cases) {
      const answers = new Map(EN_450().answers);
      answers.set(key, toResponse(line));
      const out = buildProbeResult({ answers });
      expect(out.ok && out.result.conflicts, line).toEqual([conflict]);
    }
  });

  it('classifies capability and spph answers: value, unrecognized (100), stubbed (17), other', () => {
    const base = () => new Map(EN_450().answers);
    const tokenCase = (line: string) => {
      const answers = base();
      answers.set('spep', toResponse(line));
      const out = buildProbeResult({ answers });
      return out.ok ? out.result.tokens.spep : 'not ok';
    };
    expect(tokenCase(responseLine('"spep":1', 0, 3))).toBe('value');
    expect(tokenCase(responseLine('"spep":null', 100, 3))).toBe('unrecognized');
    expect(tokenCase(responseLine('', 106, 3))).toBe('other');
    expect(tokenCase(responseLine('', 0, 3))).toBe('other'); // OK but no value

    const spphCase = (line: string) => {
      const answers = base();
      answers.set('spph', toResponse(line));
      const out = buildProbeResult({ answers });
      return out.ok ? out.result.spph : 'not ok';
    };
    expect(spphCase(responseLine('', 17, 3))).toBe('stubbed');
    expect(spphCase(responseLine('"spph":null', 100, 3))).toBe('unrecognized');
    expect(spphCase(responseLine('"spph":1', 0, 3))).toBe('value');
    expect(spphCase(responseLine('', 0, 3))).toBe('other');
    expect(spphCase(responseLine('', 106, 3))).toBe('other');
  });

  it('stock 449 probes like edge-next without the tokens', () => {
    const out = buildProbeResult(STOCK_449());
    expect(out.ok && out.result).toMatchObject({ footerRev: 3, fb: 449.01, spph: 'unrecognized', conflicts: [] });
  });
});
