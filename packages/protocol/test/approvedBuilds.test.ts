import { expect, it } from 'vitest';
import { environmentForOrigin, findApproval, NO_APPROVED_BUILDS, verifyApprovedBuilds } from '../src/approvedBuilds.ts';
const now = new Date();
it.each(['staging', 'production'] as const)('supports only the compiled builds on %s, regardless of supplied manifest', async environment => {
  const { approved } = await verifyApprovedBuilds({ builds: [{ fb: 999 }] }, { origin: '', environment, now });
  expect(approved.builds.map(b => b.fb)).toEqual([450.01, 450.02, 450.03, 450.04, 450.05, 450.06]);
  expect(findApproval(approved, 'tinyg-en', 450.06, undefined)?.supportByVersion).toBe(true);
  expect(findApproval(approved, 'tinyg-en', 450.07, undefined)).toBeUndefined();
  expect(findApproval(approved, 'tinyg-440', 450.06, undefined)).toBeUndefined();
  expect(findApproval(approved, 'tinyg-en', undefined, undefined)).toBeUndefined();
});
it('recognizes only the exact HTTPS deployed origins', async () => {
  expect(environmentForOrigin('https://run.synthetos.com')).toBe('production');
  expect(environmentForOrigin('https://staging.run.synthetos.com')).toBe('staging');
  for (const origin of ['http://run.synthetos.com', 'https://run.synthetos.com.evil.invalid', 'http://localhost']) {
    expect(environmentForOrigin(origin)).toBeNull();
    expect((await verifyApprovedBuilds({}, { origin, now })).approved).toEqual(NO_APPROVED_BUILDS);
  }
});
it('retains exact hardware, board and fbs restrictions for explicit custom approvals', () => {
  const build = { channel: 'bench' as const, dialect: 'tinyg-en' as const, fb: 450.07, fbs: 'hash', hv: 8, boardId: 'one', source: 'trusted' as const, commit: '', note: '' };
  const manifest = { environment: 'staging' as const, builds: [build] };
  expect(findApproval(manifest, 'tinyg-en', 450.07, 'hash', { hv: 8, id: 'one' })).toBe(build);
  expect(findApproval(manifest, 'tinyg-en', 450.07, undefined, { hv: 8, id: 'one' })).toBeUndefined();
  expect(findApproval(manifest, 'tinyg-en', 450.07, 'hash', { hv: 7, id: 'one' })).toBeUndefined();
  expect(findApproval(manifest, 'tinyg-en', 450.07, 'hash', { hv: 8, id: 'two' })).toBeUndefined();
});
