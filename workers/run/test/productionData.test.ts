import { expect, it } from 'vitest';
import worker from '../src/index.ts';
import { SECURITY_HEADERS } from '../src/headers.ts';
import { accountEnv } from './accountHarness.ts';

it.each(['/api/records/tool', '/api/files'])('anonymous production %s is 401 when bound and 503 before storage, with security headers', async path => {
  const { env, origin, actors } = accountEnv('production');
  const { RUN_DATA: _data, ...off } = env;
  for (const [config, expected] of [[env, 401], [off, 503]] as const) {
    const response = await worker.fetch(new Request(`${origin}${path}`), config);
    expect(response.status).toBe(expected);
    expect(response.headers.get('cache-control')).toBe('no-store');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(response.headers.get(name)).toBe(value);
  }
  expect(actors).toEqual([]);
});
