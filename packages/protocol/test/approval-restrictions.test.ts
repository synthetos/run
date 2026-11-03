/**
 * Restricted approvals (SAFETY H86, H87, T-S123): a release-list approval
 * holds for its hardware version only, and a trusted custom build for its one
 * board only; the classification says where the approval came from.
 */
import { describe, expect, it } from 'vitest';
import { buildProbeResult, classify, findApproval, type ApprovedBuild, type ApprovedBuilds, type ProbeObservations, type ProbeResult } from '../src/index.ts';
import { EN_450 } from './fixtures/probeFixtures.ts';

function probe(obs: ProbeObservations): ProbeResult {
  const out = buildProbeResult(obs);
  if (!out.ok) throw new Error(out.reason);
  return out.result;
}

const base: ApprovedBuild = { channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: '', note: '' };
const with_ = (b: Partial<ApprovedBuild>): ApprovedBuilds => ({ environment: 'staging', builds: [{ ...base, ...b }] });

describe('findApproval with restrictions', () => {
  it('a hardware-version restriction matches only that hv', () => {
    expect(findApproval(with_({ hv: 8 }), 'tinyg-en', 450.01, undefined, { hv: 8 })).toBeDefined();
    expect(findApproval(with_({ hv: 8 }), 'tinyg-en', 450.01, undefined, { hv: 99 })).toBeUndefined();
    expect(findApproval(with_({ hv: 8 }), 'tinyg-en', 450.01, undefined)).toBeUndefined();
  });

  it('a board restriction matches only that board id', () => {
    const m = with_({ boardId: '0BENCH-TWO', source: 'trusted' });
    expect(findApproval(m, 'tinyg-en', 450.01, undefined, { id: '0BENCH-TWO' })).toBeDefined();
    expect(findApproval(m, 'tinyg-en', 450.01, undefined, { id: 'OTHER' })).toBeUndefined();
    expect(findApproval(m, 'tinyg-en', 450.01, undefined, {})).toBeUndefined();
  });
});

describe('classify with restricted approvals', () => {
  it('a trusted build on its board: full, says it is custom firmware you trusted', () => {
    const c = classify(probe(EN_450()), with_({ boardId: '0BENCH-TWO', source: 'trusted', imageSha256: 'ab'.repeat(32) }));
    expect(c).toMatchObject({ mode: 'full', approvalSource: 'trusted' });
    expect(c.detail).toContain('custom firmware you trusted on this board (image sha256 abababababab)');
    expect(c.detail).toContain('approved by you on this board');
  });

  it('a trusted build without its image hash still says so', () => {
    expect(classify(probe(EN_450()), with_({ boardId: '0BENCH-TWO', source: 'trusted' })).detail).toContain('image sha256 )');
  });

  it('a trusted build on another board: read-only', () => {
    expect(classify(probe(EN_450()), with_({ boardId: 'ANOTHER', source: 'trusted' })).mode).toBe('readOnly');
  });

  it('a release-list approval for this hardware: full, as a signed release', () => {
    const c = classify(probe(EN_450()), with_({ hv: 8, source: 'release-list' }));
    expect(c).toMatchObject({ mode: 'full', approvalSource: 'release-list' });
    expect(c.detail).toContain('as a signed release on the bench channel');
    expect(classify(probe(EN_450()), with_({ hv: 7, source: 'release-list' })).mode).toBe('readOnly');
  });

  it('a plain manifest approval carries no source', () => {
    expect(classify(probe(EN_450()), with_({})).approvalSource).toBeUndefined();
  });
});
