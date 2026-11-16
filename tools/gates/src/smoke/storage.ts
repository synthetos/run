import { checkSecurityHeaders, type Observed, type SmokeFinding } from './checks.ts';
/** Anonymous production storage is either unavailable before go-live or requires the run session. */
export function checkStorage(res: Observed): SmokeFinding[] {
  const findings = checkSecurityHeaders(res);
  if (res.status !== 401 && res.status !== 503) findings.push({ check: 'storage', message: `${res.url}: status ${res.status}, expected 401 or 503` });
  if (res.headers.get('cache-control') !== 'no-store') findings.push({ check: 'storage', message: `${res.url}: expected no-store` });
  return findings;
}
