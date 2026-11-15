/**
 * P0-08 review regressions (independent review batch 10 #1-#3, re-verified open at
 * 89e2b5f). Every case runs the production path: raw lines through
 * `classifyLine`, `buildProbeResult`, then `classify` against a manifest that
 * `verifyApprovedBuilds` produced (the committed signed file where it can).
 *
 * #2 The footer contract is checked end to end. Once a candidate dialect is
 *    known, every collected response and the banner must have that
 *    dialect's footer shape before full mode: 440.21 always prints
 *    `[1,status,n,checksum]` (@cite TG json_parser.c:529, :543-550), g2core
 *    prints `[1,status,n]` (@cite G2 json_parser.cpp:612-616).
 * #1 A capability answer proves the edge-next contract only when its value
 *    is one the firmware can print: `spep`, `prbp` and `os` are uint8
 *    settings whose setters refuse anything above 1 (@cite EN
 *    config_app.c:650, :657, :668; spindle.c:64; switch.c:336; config.c:536-541);
 *    `fstk` is the unused-stack watermark, an unsigned count of bytes between
 *    `__heap_start` and SP on the atxmega192a3's 16 KB SRAM, so 0..16383
 *    (@cite EN stack_report.c:47-58; Makefile:14).
 * Firmware support now comes from reviewed code (owner 2026-11-15);
 * advisory clock/data validation is covered in safetyAdvisory.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_TOKENS,
  G2CORE_EDGE,
  TINYG_440,
  TINYG_449_STOCK,
  TINYG_EN,
  buildProbeResult,
  checksum440,
  classify,
  classifyLine,
  verifyApprovedBuilds,
} from '../src/index.ts';
import type { ApprovedBuilds, Footer, ProbeKey, ProbeObservations, ProbeResult, Response } from '../src/index.ts';
import { EN_450, EN_PIN, G2_EDGE, STOCK_449, TG_440, toBanner } from './fixtures/probeFixtures.ts';

const STAGING = 'https://staging.run.synthetos.com';
const COMMITTED = null;
const TG_COMMIT = 'd04183905470714254c24d299f6aad75f6bcbb7a';

async function committedStaging(now = new Date('2026-11-06T00:00:00Z')): Promise<ApprovedBuilds> {
  return (await verifyApprovedBuilds(COMMITTED, { origin: STAGING, now })).approved;
}

/** A synthetic future TG approval, as in the independent review's reproduction (the committed manifest approves no TG). */
const FUTURE_TG: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-440', fb: 440.21, fbs: null, commit: TG_COMMIT, note: 'synthetic future approval' }],
};

function response(line: string): Response {
  const c = classifyLine(line);
  if (c.kind !== 'Response') throw new Error(`not a Response: ${line} (${c.kind})`);
  return c;
}

function withAnswer(obs: ProbeObservations, key: ProbeKey, line: string): ProbeObservations {
  const answers = new Map(obs.answers);
  answers.set(key, response(line));
  return obs.banner === undefined ? { answers } : { answers, banner: obs.banner };
}

function probe(obs: ProbeObservations): ProbeResult {
  const out = buildProbeResult(obs);
  if (!out.ok) throw new Error(`probe failed: ${out.reason}`);
  return out.result;
}

/** The body of a response as JSON text, without its footer. */
function body(r: Response): string {
  return JSON.stringify(r.r);
}

const tgLine = (inner: string, status = 0): string => {
  const prefix = `{"r":${inner},"f":[1,${status},12,`;
  return `${prefix}${checksum440(`${prefix}0`)}]}`;
};

describe('P0-08 #2: the dialect footer contract is enforced before full mode', () => {
  it('Independent review reproduction: a checksumless fb answer on an otherwise 440.21 probe is never full', () => {
    const obs = withAnswer(TG_440(), 'fb', '{"r":{"fb":440.21},"f":[1,0,12]}');
    const out = buildProbeResult(obs);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const c = classify(out.result, FUTURE_TG);
    expect(c.mode).toBe('readOnly');
    expect(c.dialect).toBeNull();
    expect(c.detail).toMatch(/footer/);
  });

  it('every probe answer is checked: a checksumless footer on any one of them blocks full', () => {
    const base = TG_440();
    for (const [key, r] of base.answers) {
      const line = `{"r":${body(r)},"f":[1,${r.footer.status},12]}`;
      const c = classify(probe(withAnswer(base, key, line)), FUTURE_TG);
      expect(c.mode, key).toBe('readOnly');
    }
  });

  it('the banner is checked too: a 440.21 banner without a checksum blocks full', () => {
    const banner = toBanner('{"r":{"fv":0.97,"fb":440.21,"hp":1,"hv":8,"id":"0BENCH-TWO","msg":"SYSTEM READY"},"f":[1,0,0]}');
    const c = classify(probe({ ...TG_440(), banner }), FUTURE_TG);
    expect(c.mode).toBe('readOnly');
  });

  it('a valid checksummed 440.21 probe, with or without a checksummed banner, is still full under an approval', () => {
    expect(classify(probe(TG_440()), FUTURE_TG)).toMatchObject({ dialect: TINYG_440, mode: 'full' });
    const banner = toBanner(tgLine('{"fv":0.97,"fb":440.21,"hp":1,"hv":8,"id":"0BENCH-TWO","msg":"SYSTEM READY"}'));
    expect(classify(probe({ ...TG_440(), banner }), FUTURE_TG)).toMatchObject({ dialect: TINYG_440, mode: 'full' });
  });

  it('the evidence is preserved: the probe result carries every footer it saw, banner included', () => {
    const banner = toBanner(tgLine('{"fv":0.97,"fb":440.21,"hp":1,"hv":8,"id":"0BENCH-TWO","msg":"SYSTEM READY"}'));
    const p = probe({ ...TG_440(), banner });
    // 11 answers (identity 5, fbs, 4 capability tokens, spph) plus the banner.
    expect(p.footers).toHaveLength(12);
    expect(p.footers.every((f) => f.checksum !== undefined)).toBe(true);
    expect(Object.isFrozen(p.footers)).toBe(true);
  });

  it('g2core three-field rev 1 is preserved; a four-field footer is not g2core', () => {
    expect(classify(probe(G2_EDGE()), FUTURE_TG)).toMatchObject({ dialect: G2CORE_EDGE, mode: 'readOnly', reason: 'g2core-read-only' });
    const g2 = G2_EDGE();
    const fb = g2.answers.get('fb') as Response;
    const c = classify(probe(withAnswer(g2, 'fb', tgLine(body(fb)))), FUTURE_TG);
    expect(c.dialect).toBeNull();
    expect(c.mode).toBe('readOnly');
  });

  it('every row checks it, read-only rows included: a stock 449 probe with a rev-1 footer is not stock 449', () => {
    const stock = probe(STOCK_449());
    expect(classify(stock, FUTURE_TG)).toMatchObject({ dialect: TINYG_449_STOCK, mode: 'readOnly' });
    const tg = probe(TG_440()).footers[0];
    const c = classify({ ...stock, footers: [...stock.footers, tg as Footer] }, FUTURE_TG);
    expect(c).toMatchObject({ dialect: null, mode: 'readOnly', reason: 'conflict' });
    expect(c.detail).toContain('footer contract');
  });

  it('a hand-built probe result with no footer evidence never reaches full', async () => {
    const p = probe(EN_PIN());
    const manifest = await committedStaging();
    expect(classify(p, manifest).mode).toBe('full');
    expect(classify({ ...p, footers: [] }, manifest)).toMatchObject({ mode: 'readOnly', dialect: null });
    expect(classify({ ...p, footers: [] }, manifest).detail).toContain('no footers recorded');
    // A JavaScript caller that omits the field entirely is treated the same way.
    expect(classify({ ...p, footers: undefined as unknown as ProbeResult['footers'] }, manifest).mode).toBe('readOnly');
    expect(classify({ ...probe(TG_440()), footers: [] }, FUTURE_TG).mode).toBe('readOnly');
  });
});

describe('P0-08 #1: malformed capability values never prove the edge-next contract', () => {
  const MALFORMED: readonly string[] = ['null', '{}', '"bad"', '999', '2', '-1', '0.5', 'true', 'false', '[]', '[1]', '"1"', '1e300', '-0'];

  it('Independent review reproduction: spep null, {}, "bad", 999 against the committed signed bench manifest', async () => {
    const manifest = await committedStaging();
    for (const v of ['null', '{}', '"bad"', '999']) {
      const c = classify(probe(withAnswer(EN_450(), 'spep', `{"r":{"spep":${v}},"f":[3,0,11]}`)), manifest);
      expect(c.mode, v).toBe('readOnly');
    }
  });

  it('every capability token, every malformed value: READ_ONLY, recorded as a conflict', async () => {
    const manifest = await committedStaging();
    for (const token of CAPABILITY_TOKENS) {
      // 2 and 999 are in range for fstk (a byte count), out of range for the 0/1 settings.
      const values = token === 'fstk' ? [...MALFORMED.filter((v) => v !== '2' && v !== '999'), '16384', '65535', '4294967295'] : MALFORMED;
      for (const v of values) {
        const p = probe(withAnswer(EN_450(), token, `{"r":{"${token}":${v}},"f":[3,0,11]}`));
        expect(p.tokens[token], `${token}=${v}`).toBe('other');
        expect(p.conflicts.some((x) => x.startsWith(`${token}:`)), `${token}=${v}`).toBe(true);
        expect(classify(p, manifest).mode, `${token}=${v}`).toBe('readOnly');
      }
    }
  });

  it('the values the firmware can print still prove it: 0 and 1, and fstk 0..16383', async () => {
    const manifest = await committedStaging();
    for (const token of ['spep', 'prbp', 'os'] as const) {
      for (const v of ['0', '1']) {
        const c = classify(probe(withAnswer(EN_PIN(), token, `{"r":{"${token}":${v}},"f":[3,0,11]}`)), manifest);
        expect(c, `${token}=${v}`).toMatchObject({ dialect: TINYG_EN, mode: 'full' });
      }
    }
    for (const v of ['0', '1180', '16383']) {
      const c = classify(probe(withAnswer(EN_PIN(), 'fstk', `{"r":{"fstk":${v}},"f":[3,0,11]}`)), manifest);
      expect(c, `fstk=${v}`).toMatchObject({ dialect: TINYG_EN, mode: 'full' });
    }
  });

  it('a TinyG 440.21 board answering a capability token with status 0 and junk is not 440.21', () => {
    const c = classify(probe(withAnswer(TG_440(), 'os', tgLine('{"os":"bad"}'))), FUTURE_TG);
    expect(c.mode).toBe('readOnly');
  });
});
