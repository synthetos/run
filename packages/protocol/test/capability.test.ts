/**
 * T-S55: classifier fixtures (SAFETY H44; PN §2.3). A board is classified by
 * the capability probe plus the signed manifest, never by `fb` alone.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_TOKENS,
  G2CORE_EDGE,
  NO_APPROVED_BUILDS,
  TINYG_440,
  TINYG_449_STOCK,
  TINYG_EN,
  buildProbeResult,
  classify,
  footerFitsDialect,
  verifyApprovedBuilds,
} from '../src/index.ts';
import type { ApprovedBuild, ApprovedBuilds, Footer, ProbeObservations, ProbeResult } from '../src/index.ts';
import { EN_CAPABILITIES, EN_450, G2_EDGE, NO_CAPABILITIES, STOCK_449, TG_440, observations, tinygIdentity } from './fixtures/probeFixtures.ts';

const EN_COMMIT = '93a723b813d3eb2cf6cf2b90e919a2affef557d1';
const TG_COMMIT = 'd04183905470714254c24d299f6aad75f6bcbb7a';

const approval = (dialect: ApprovedBuild['dialect'], fb: number, commit = EN_COMMIT): ApprovedBuild => ({
  channel: 'bench',
  dialect,
  fb,
  fbs: null,
  commit,
  note: '',
});
const BENCH: ApprovedBuilds = { environment: 'staging', builds: [approval('tinyg-en', 450.01)] };

function probe(obs: ProbeObservations): ProbeResult {
  const out = buildProbeResult(obs);
  if (!out.ok) throw new Error(`fixture probe failed: ${out.reason}`);
  return out.result;
}

describe('T-S55: classifier fixtures', () => {
  it('EN probe answers with the fb approved → tinyg-en, full', () => {
    const c = classify(probe(EN_450()), BENCH);
    expect(c).toMatchObject({ dialect: TINYG_EN, mode: 'full', reason: 'en-approved', upgradeOffer: false });
    expect(c.approval).toEqual(BENCH.builds[0]);
    expect(c.detail).toContain('450.01');
    // The probe cannot verify the commit, and with no fbs every 450.01 build matches: never claim it.
    expect(c.detail).not.toContain('93a723b8');
    expect(c.detail).toContain('commit not verifiable');
    expect(c.buildIdentity).toBe('fbOnly');
  });

  it('a board reporting an fbs never matches an fbs-null entry; an entry naming that fbs approves it and is shown as identified', () => {
    const reporting = observations({ ...tinygIdentity('450.01'), fbs: { body: '"fbs":"450.01-3-g222a45c"', status: 0 }, ...EN_CAPABILITIES }, 3);
    expect(classify(probe(reporting), BENCH)).toMatchObject({ dialect: TINYG_EN, mode: 'readOnly', reason: 'en-not-approved' });
    const named: ApprovedBuilds = { environment: 'staging', builds: [{ ...approval('tinyg-en', 450.01), fbs: '450.01-3-g222a45c' }] };
    const c = classify(probe(reporting), named);
    expect(c).toMatchObject({ mode: 'full', buildIdentity: 'fbs' });
    expect(c.detail).toContain('identified by fbs');
    expect(c.detail).toContain('93a723b8');
    // And the fbs-less board does not match the named entry.
    expect(classify(probe(EN_450()), named).mode).toBe('readOnly');
  });

  it('the same EN answers with the fb NOT approved → tinyg-en, READ_ONLY, with the reason', () => {
    const c = classify(probe(EN_450()), NO_APPROVED_BUILDS);
    expect(c).toMatchObject({ dialect: TINYG_EN, mode: 'readOnly', reason: 'en-not-approved' });
    expect(c.detail).toMatch(/not approved/);
    expect(c.approval).toBeUndefined();
    // A manifest approving a different build does not help.
    expect(classify(probe(EN_450()), { environment: 'staging', builds: [approval('tinyg-en', 450.02)] }).mode).toBe('readOnly');
  });

  it('the same fb without the capability tokens → never edge-next (H44)', () => {
    // The fb edge-next reported until the D4 bump, without tokens: stock edge-0.97, READ_ONLY with an upgrade offer.
    const stock = classify(probe(observations({ ...tinygIdentity('449.01'), ...NO_CAPABILITIES }, 3)), {
      environment: 'staging',
      builds: [approval('tinyg-en', 449.01)],
    });
    expect(stock).toMatchObject({ dialect: TINYG_449_STOCK, mode: 'readOnly', reason: 'stock-449', upgradeOffer: true });
    // Today's edge-next fb (450.01), approved in the manifest, but without the tokens: no row matches.
    const unknown = classify(probe(observations({ ...tinygIdentity('450.01'), ...NO_CAPABILITIES }, 3)), BENCH);
    expect(unknown).toMatchObject({ dialect: null, mode: 'readOnly', reason: 'conflict' });
  });

  it('stock 449 → tinyg-449-stock READ_ONLY even if a manifest lists it', () => {
    const c = classify(probe(STOCK_449()), { environment: 'staging', builds: [approval('tinyg-449-stock', 449.01)] });
    expect(c).toMatchObject({ dialect: TINYG_449_STOCK, mode: 'readOnly', upgradeOffer: true });
  });

  it('a 440.21 rev-1 fixture → tinyg-440: READ_ONLY until the manifest approves it (D22, HIL-6.1)', () => {
    expect(classify(probe(TG_440()), BENCH)).toMatchObject({ dialect: TINYG_440, mode: 'readOnly', reason: 'tg440-not-approved', upgradeOffer: true });
    const approved = classify(probe(TG_440()), { environment: 'staging', builds: [approval('tinyg-440', 440.21, TG_COMMIT)] });
    expect(approved).toMatchObject({ dialect: TINYG_440, mode: 'full', reason: 'tg440-approved' });
  });

  it('other 440.xx builds are not the 440.21 dialect', () => {
    const c = classify(probe(observations({ ...tinygIdentity('440.20'), ...NO_CAPABILITIES }, 1)), NO_APPROVED_BUILDS);
    expect(c).toMatchObject({ dialect: null, mode: 'readOnly' });
  });

  it('g2core edge → g2core-edge READ_ONLY; another g2 build has no dialect', () => {
    expect(classify(probe(G2_EDGE()), NO_APPROVED_BUILDS)).toMatchObject({ dialect: G2CORE_EDGE, mode: 'readOnly', reason: 'g2core-read-only' });
    expect(classify(probe(G2_EDGE('101.03')), NO_APPROVED_BUILDS)).toMatchObject({ dialect: null, mode: 'readOnly', reason: 'g2core-unknown-build' });
  });

  describe('conflicts → READ_ONLY', () => {
    const base = (): ProbeResult => probe(EN_450());
    const cases: [string, Partial<ProbeResult>][] = [
      ['a probe conflict', { conflicts: ['fb: banner says 449.01, GET says 450.01'] }],
      ['TinyG and g2 signals together', { hp: 'gQuintic' }],
      ['fv 0.99 on a TinyG fb', { fv: 0.99 }],
      ['the TG banner shape on edge-next', { banner: 'r-footer' }],
      ['footer rev 1 with edge-next tokens', { footerRev: 1 }],
      ['only some capability tokens', { tokens: { spep: 'value', prbp: 'value', fstk: 'unrecognized', os: 'value' } }],
      ['a token answering another error', { tokens: { spep: 'value', prbp: 'other', fstk: 'value', os: 'value' } }],
      ['spph answering a value (unknown E060 build)', { spph: 'value' }],
      ['hp not 1', { hp: 3758096385 }],
      ['fv not 0.97', { fv: 0.98 }],
    ];
    for (const [name, change] of cases) {
      it(name, () => {
        const c = classify({ ...base(), ...change }, BENCH);
        expect(c.mode, name).toBe('readOnly');
        expect(c.dialect === TINYG_EN && c.mode === 'full').toBe(false);
      });
    }

    it('a stock-449 fb with the bare-sr banner shape mismatch, or a g2 hp, is not stock 449', () => {
      const stock = probe(STOCK_449());
      expect(classify({ ...stock, banner: 'r-footer' }, NO_APPROVED_BUILDS).dialect).toBeNull();
      expect(classify({ ...stock, footerRev: 1 }, NO_APPROVED_BUILDS).dialect).toBeNull();
    });

    it('a 440.21 board printing the bare-sr banner is not 440.21', () => {
      expect(classify({ ...probe(TG_440()), banner: 'bare-sr' }, BENCH).dialect).toBeNull();
    });

    it('an unclassified board gets no dialect and no upgrade offer', () => {
      const c = classify({ ...base(), conflicts: ['x'] }, BENCH);
      expect(c).toMatchObject({ dialect: null, mode: 'readOnly', reason: 'conflict', upgradeOffer: false });
      expect(c.detail).toContain('x');
    });
  });

  it('a stock 449 board with the broken hp (E104) is still stock 449', () => {
    const c = classify({ ...probe(STOCK_449()), hp: 3758096385 }, NO_APPROVED_BUILDS);
    expect(c.dialect).toBe(TINYG_449_STOCK);
  });

  it('a build reporting fbs needs an entry with that exact fbs', () => {
    const p = { ...probe(EN_450()), fbs: 'a4103ff8' };
    expect(classify(p, BENCH).mode).toBe('readOnly');
    const withFbs: ApprovedBuilds = { environment: 'staging', builds: [{ ...approval('tinyg-en', 450.01), fbs: 'a4103ff8' }] };
    const c = classify(p, withFbs);
    expect(c.mode).toBe('full');
    expect(c.detail).toContain('a4103ff8');
  });
});

describe('end to end: probe transcript + the committed signed manifest', () => {
  const REPO = resolve(import.meta.dirname, '../../..');
  const committed = JSON.parse(readFileSync(join(REPO, 'firmware/approved-builds.json'), 'utf8')) as unknown;
  const NOW = new Date('2026-11-01T12:00:00Z');

  it('staging: the pinned edge-next candidate is full', async () => {
    const { approved } = await verifyApprovedBuilds(committed, { origin: 'https://staging.run.synthetos.com', now: NOW });
    expect(classify(probe(EN_450()), approved)).toMatchObject({ dialect: TINYG_EN, mode: 'full' });
  });

  it('production: the same board is READ_ONLY (bench approvals never reach production)', async () => {
    const { approved } = await verifyApprovedBuilds(committed, { origin: 'https://run.synthetos.com', now: NOW });
    expect(classify(probe(EN_450()), approved)).toMatchObject({ dialect: TINYG_EN, mode: 'readOnly', reason: 'en-not-approved' });
  });

  it('a local dev origin: READ_ONLY', async () => {
    const { approved } = await verifyApprovedBuilds(committed, { origin: 'http://localhost:5173', now: NOW });
    expect(classify(probe(EN_450()), approved).mode).toBe('readOnly');
  });
});

describe('properties', () => {
  const answer = fc.constantFrom('value' as const, 'unrecognized' as const, 'other' as const);
  const footerArb: fc.Arbitrary<Footer> = fc
    .record({ rev: fc.constantFrom(1 as const, 2 as const, 3 as const), checksum: fc.option(fc.constant(4242), { nil: undefined }) })
    .map(({ rev, checksum }) =>
      checksum === undefined ? { rev, status: 0, field3: 11, raw: [rev, 0, 11] } : { rev, status: 0, field3: 11, checksum, raw: [rev, 0, 11, checksum] },
    );
  const probeArb: fc.Arbitrary<ProbeResult> = fc.record({
    banner: fc.constantFrom('r-footer' as const, 'bare-sr' as const, 'none' as const),
    footerRev: fc.constantFrom(1 as const, 2 as const, 3 as const),
    fb: fc.option(fc.constantFrom(440.21, 440.2, 449.01, 449.5, 450.01, 450.02, 101.06, 101.03, 0), { nil: undefined }),
    fv: fc.option(fc.constantFrom(0.97, 0.98, 0.99), { nil: undefined }),
    hp: fc.option(fc.oneof(fc.constantFrom(1, 3758096385), fc.constantFrom('ArduinoDue', 'gQuintic')), { nil: undefined }),
    tokens: fc.record({ spep: answer, prbp: answer, fstk: answer, os: answer }),
    spph: fc.constantFrom('stubbed' as const, 'value' as const, 'unrecognized' as const, 'other' as const),
    footers: fc.array(footerArb, { maxLength: 4 }),
    conflicts: fc.constantFrom([], ['x']),
  }) as fc.Arbitrary<ProbeResult>;
  const manifestArb: fc.Arbitrary<ApprovedBuilds> = fc.record({
    environment: fc.constantFrom('staging' as const, 'production' as const, null),
    builds: fc.array(
      fc.record({
        channel: fc.constantFrom('bench' as const, 'release' as const),
        dialect: fc.constantFrom('tinyg-en' as const, 'tinyg-440' as const, 'tinyg-449-stock' as const, 'g2core-edge' as const),
        fb: fc.constantFrom(440.21, 449.01, 450.01, 101.06),
        fbs: fc.constant(null),
        commit: fc.constant(EN_COMMIT),
        note: fc.constant(''),
      }),
      { maxLength: 4 },
    ),
  });

  it('full only on an approvable dialect, with a manifest entry for exactly that dialect and fb', () => {
    fc.assert(
      fc.property(probeArb, manifestArb, (p, m) => {
        const c = classify(p, m);
        if (c.mode !== 'full') return;
        expect(c.dialect?.mode).toBe('manifest');
        expect(c.approval?.dialect).toBe(c.dialect?.id);
        expect(c.approval?.fb).toBe(p.fb);
        expect(m.builds).toContain(c.approval);
        expect(p.conflicts).toEqual([]);
      }),
      { numRuns: 2000 },
    );
  });

  it('edge-next full requires every capability token and a stubbed spph (never fb alone)', () => {
    fc.assert(
      fc.property(probeArb, manifestArb, (p, m) => {
        const c = classify(p, m);
        if (c.dialect !== TINYG_EN) return;
        expect(CAPABILITY_TOKENS.every((t) => p.tokens[t] === 'value')).toBe(true);
        expect(p.spph).toBe('stubbed');
        expect(p.hp).toBe(1);
      }),
      { numRuns: 2000 },
    );
  });

  it('read-only dialects and unclassified boards are never full; classify never throws', () => {
    fc.assert(
      fc.property(probeArb, manifestArb, (p, m) => {
        const c = classify(p, m);
        if (c.dialect === null || c.dialect.mode === 'readOnly') expect(c.mode).toBe('readOnly');
        expect(typeof c.detail).toBe('string');
      }),
      { numRuns: 2000 },
    );
  });

  it('full only when the probe recorded footers and every one meets the dialect footer contract (P0-08 review)', () => {
    fc.assert(
      fc.property(probeArb, manifestArb, (p, m) => {
        const c = classify(p, m);
        if (c.mode !== 'full' || c.dialect === null) return;
        expect(p.footers.length).toBeGreaterThan(0);
        for (const f of p.footers) expect(footerFitsDialect(c.dialect, f)).toBe(true);
      }),
      { numRuns: 4000 },
    );
  });

  it('with no approvals at all, nothing is ever full', () => {
    fc.assert(
      fc.property(probeArb, (p) => {
        expect(classify(p, NO_APPROVED_BUILDS).mode).toBe('readOnly');
      }),
      { numRuns: 1000 },
    );
  });

  it('the EN fixture proves the property generator reaches the full path', () => {
    expect(classify(probe(observations({ ...tinygIdentity('450.01'), ...EN_CAPABILITIES }, 2)), BENCH).mode).toBe('full');
  });
});
