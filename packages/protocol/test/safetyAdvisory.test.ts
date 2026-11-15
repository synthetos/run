import { expect, it } from 'vitest';
import { ADVISORY_PAYLOAD_FORMAT, SAFETY_ADVISORY_FORMAT, verifySafetyAdvisory, findRevocation } from '../src/safetyAdvisory.ts';
const row = { format: ADVISORY_PAYLOAD_FORMAT, env: 'production', issued: '2026-01-01T00:00:00Z', expires: '2027-01-01T00:00:00Z', revoked: [{ sha: 'a'.repeat(40), reason: 'Stop defect' }] };
const file = (rows: unknown[] = [row]) => ({ format: SAFETY_ADVISORY_FORMAT, advisories: rows });
const options = { environment: 'production' as const, now: new Date('2026-11-15T00:00:00Z') };
it('reads deployed per-environment revocations and recognizes dirty app builds', async () => {
  const result = await verifySafetyAdvisory(file(), options);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error('rejected');
  expect(findRevocation(result.advisory, `${'a'.repeat(40)}-dirty`)?.reason).toBe('Stop defect');
  expect(findRevocation(result.advisory, 'b'.repeat(40))).toBeUndefined();
});
it('refuses malformed, wrong-environment, ambiguous and obsolete signed data', async () => {
  for (const input of [null, {}, file([]), file([row, row]), file([{ ...row, env: 'staging' }]), file([{ env: 'production', kid: 'old', payload: JSON.stringify(row), sig: 'old' }]), file([{ ...row, revoked: [{ sha: 'bad', reason: 'x' }] }])]) expect((await verifySafetyAdvisory(input, options)).ok).toBe(false);
});
it.each(['2025-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'invalid'])('refuses outside validity or invalid clock %s', async time => {
  expect((await verifySafetyAdvisory(file(), { ...options, now: new Date(time) })).ok).toBe(false);
});
