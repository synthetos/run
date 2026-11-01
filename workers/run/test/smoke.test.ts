import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import worker, { VERSION } from '../src/index.ts';

describe('@synthetos/run-worker', () => {
  it('exports VERSION equal to the package.json version', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('answers every path with an uncacheable 404 until P0-04 defines routes', async () => {
    for (const path of ['/', '/api/health', '/auth/login', '/anything']) {
      const res = worker.fetch(new Request(`https://run.synthetos.com${path}`));
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(await res.text()).toBe('Not found\n');
    }
  });
});
