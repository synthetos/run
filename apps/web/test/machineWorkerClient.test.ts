/**
 * Starting `machine.worker` (ROADMAP P0-14, src/machine-worker/client.ts):
 * only through the `rs-worker` Trusted Types policy, as a named module
 * worker, and not at all without Trusted Types (fail closed).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MACHINE_WORKER_NAME, startMachineWorker } from '../src/machine-worker/client.ts';
import type { RunTrustedTypes } from '../src/security/tt.ts';

const constructed: { url: unknown; options: unknown }[] = [];

class FakeWorker {
  constructor(url: unknown, options: unknown) {
    constructed.push({ url, options });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  constructed.length = 0;
});

describe('startMachineWorker', () => {
  it('starts nothing without Trusted Types', () => {
    vi.stubGlobal('Worker', FakeWorker);
    expect(startMachineWorker(null)).toBeNull();
    expect(constructed).toEqual([]);
  });

  it('passes the worker chunk URL through the rs-worker policy and starts a named module worker', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const seen: string[] = [];
    const trusted = { trusted: true };
    const tt: RunTrustedTypes = {
      workerScriptUrl: (path) => {
        seen.push(path);
        return trusted;
      },
      svgExportBlob: () => {
        throw new Error('not used');
      },
    };
    expect(startMachineWorker(tt)).toBeInstanceOf(FakeWorker);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/machine\.worker/);
    expect(constructed).toEqual([{ url: trusted, options: { type: 'module', name: MACHINE_WORKER_NAME } }]);
    expect(MACHINE_WORKER_NAME).toBe('machine');
  });
});
