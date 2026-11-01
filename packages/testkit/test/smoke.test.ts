import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import * as mod from '../src/index.ts';

const SRC = resolve(import.meta.dirname, '../src');
const sources = (): [string, string][] =>
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, readFileSync(join(SRC, f), 'utf8')]);

describe('@synthetos/testkit', () => {
  it('exports VERSION equal to the package.json version', () => {
    expect(mod.VERSION).toBe(pkg.version);
    expect(mod.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is private (dev only), side-effect free and exposes its entry through the exports map', () => {
    expect(pkg.private).toBe(true);
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.exports['.']).toBe('./src/index.ts');
    expect(Object.keys((pkg as { dependencies?: object }).dependencies ?? {})).toEqual([]); // nothing ships with it
  });

  it('exports the marker literal that the bundle scan searches for', () => {
    expect(mod.TESTKIT_MARKER).toBe('__SYNTHETOS_TESTKIT_DEV_ONLY__');
  });

  it('exports the P0-11 parts: clock, models, endpoint, fault plans, mock port, replay, register', () => {
    for (const name of [
      'VirtualClock',
      'SeededRng',
      'SimEndpoint',
      'SimHost',
      'createSim',
      'validateFaultPlan',
      'MockSerialPort',
      'ReplayTransport',
      'recordingFromTranscript',
      'TinyGEdgeNextModel',
      'TinyG440Model',
      'ModelGapError',
      'BEHAVIOURS',
      'MODEL_LIMITS',
      'renderStatus',
      'validateBehaviours',
    ]) {
      expect(typeof (mod as Record<string, unknown>)[name], name).not.toBe('undefined');
    }
  });

  it('runtime source uses no Node built-ins, so the kit also runs in a browser (P0-14 fake navigator.serial)', () => {
    for (const [file, text] of sources()) expect(text, file).not.toMatch(/from\s+'node:|require\(/);
  });

  it('never touches navigator.serial in code: MockSerialPort only has the SerialPort shape', () => {
    for (const [file, text] of sources()) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/navigator|requestPort|getPorts/);
    }
  });
});
