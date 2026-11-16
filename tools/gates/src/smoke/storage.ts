import { checkSecurityHeaders, type Observed, type SmokeFinding } from './checks.ts';
/** Anonymous production storage is checked against the effective deployment bindings. */
export function checkStorage(res: Observed, enabled: string | undefined): SmokeFinding[] {
  const findings = checkSecurityHeaders(res);
  if (enabled !== 'true' && enabled !== 'false') findings.push({ check: 'storage', message: 'RUN_STORAGE_ENABLED must be true or false from the Run preflight' });
  const expected = enabled === 'true' ? 401 : 503;
  if (res.status !== expected) findings.push({ check: 'storage', message: `${res.url}: status ${res.status}, expected ${expected}` });
  if (res.headers.get('cache-control') !== 'no-store') findings.push({ check: 'storage', message: `${res.url}: expected no-store` });
  return findings;
}
