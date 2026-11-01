/**
 * Each Playwright suite runs only in its own served modes (src/suite.ts,
 * ROADMAP P0-14): the main suite never against the fake-serial test build,
 * the fake-serial suite never against anything else.
 */
import { describe, expect, it } from 'vitest';
import { suiteConfig } from '../src/suite.ts';

const MAIN = { name: 'main', port: 8790, testMatch: '**/*.e2e.ts', modes: ['source', 'artifact'] } as const;
const FAKE = { name: 'fake-serial', port: 8791, testMatch: '**/*.fake-serial.ts', modes: ['fake-serial'] } as const;

describe('suiteConfig', () => {
  it('builds the main suite in source mode', () => {
    const config = suiteConfig(MAIN, {}, '/w');
    expect(config.testMatch).toBe('**/*.e2e.ts');
    expect(config.use?.baseURL).toBe('http://127.0.0.1:8790');
    expect(config.reporter).toEqual([['list']]);
    expect(config.forbidOnly).toBe(true);
  });

  it('adds the JSON report when asked', () => {
    expect(suiteConfig(MAIN, { RUN_E2E_REPORT: '/tmp/r.json' }, '/w').reporter).toEqual([['list'], ['json', { outputFile: '/tmp/r.json' }]]);
  });

  it('refuses the main suite against the fake-serial build', () => {
    expect(() => suiteConfig(MAIN, { RUN_E2E_FAKE_SERIAL: '1' }, '/w')).toThrow(/main suite runs only in source or artifact mode, not fake-serial/);
  });

  it('runs the fake-serial suite only in fake-serial mode, serving the test build', () => {
    expect(() => suiteConfig(FAKE, {}, '/w')).toThrow(/fake-serial suite runs only in fake-serial mode, not source/);
    expect(() => suiteConfig(FAKE, { RUN_E2E_SITE: 's', RUN_E2E_WORKER: 'w' }, '/w')).toThrow(/not artifact/);
    const config = suiteConfig(FAKE, { RUN_E2E_FAKE_SERIAL: '1' }, '/w');
    expect(config.testMatch).toBe('**/*.fake-serial.ts');
    const server = config.webServer as { command: string };
    expect(server.command).toContain('--assets');
    expect(server.command).toContain('dist-fake-serial');
  });
});
