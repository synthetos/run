import { expect, it } from 'vitest';
import { buildProbeResult, classify, verifyApprovedBuilds } from '../src/index.ts';
import { EN_CAPABILITIES, observations, tinygIdentity } from './fixtures/probeFixtures.ts';
import { classifyLine } from '../src/classify.ts';
it('accepts 450.06 spindle status/GET fields and test-stub refusal as ordinary frames', () => {
  for (const token of ['sso', 'ssoe', 'ssc', 'scp', 'sse']) {
    expect(classifyLine(JSON.stringify({ r: { [token]: 1 }, f: [3, 0, 10] })).kind).toBe('Response');
    expect(classifyLine(JSON.stringify({ sr: { [token]: 1 } })).kind).toBe('StatusReport');
  }
  expect(classifyLine('{"r":{"test":1},"f":[3,17,10]}')).toMatchObject({ kind: 'Response', footer: { status: 17 } });
});
it('requires the EN capability evidence even for a supported 450.06, and leaves 450.07 read-only', async () => {
  const { approved } = await verifyApprovedBuilds(null, { origin: 'https://run.synthetos.com', now: new Date() });
  for (const [fb, mode] of [['450.06', 'full'], ['450.07', 'readOnly']] as const) {
    const result = buildProbeResult(observations({ ...tinygIdentity(fb), ...EN_CAPABILITIES, spph: { body: '"spph":null', status: 100 } }, 3));
    if (!result.ok) throw Error('bad fixture');
    expect(classify(result.result, approved)).toMatchObject({ mode, dialect: { id: 'tinyg-en' } });
    expect(classify({ ...result.result, spph: 'value' }, approved).mode).toBe('readOnly');
  }
});
