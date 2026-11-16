import { expect, it } from 'vitest';
import { LiveOverrides, spindleCapped } from '../src/firmware/liveOverrides.ts';
it('[EN-45006-OVERRIDES] requests, read-only/range refusals, ordered locks, and resets', () => {
  const model = new LiveOverrides();
  expect(model.write('mfo', 1.2)).toBe(0);
  expect(model.write('sso', 0.8)).toBe(0);
  expect(model.read('mfc', true, false)).toBe(1.2);
  expect(model.read('ssc', true, false)).toBe(0.8);
  expect(model.read('ssc', false, false)).toBe(1);
  expect(model.write('mfo', 3)).toBe(110);
  expect(model.write('ssc', 1)).toBe(104);
  expect(model.read('mfo', true, false)).toBe(1.2);
  model.program(49);
  expect(model.read('mfe', true, false)).toBe(0);
  expect(model.read('sse', true, false)).toBe(0);
  model.write('mfoe', 1); model.write('ssoe', 1);
  expect(model.read('mfe', true, false)).toBe(0);
  model.program(48); model.program(50, 0);
  expect(model.read('sse', true, false)).toBe(1);
  model.program(51, 0);
  expect(model.read('sse', true, false)).toBe(0);
  model.reset();
  for (const token of ['mfo', 'mfc', 'mfe', 'sso', 'ssc', 'sse']) expect(model.read(token, true, false)).toBe(1);
});

it('[EN-45006-OVERRIDES] spindle caps use both limits and the effective program permission', () => {
  const state = new LiveOverrides(), range = { low: 1000, high: 12000 };
  state.write('sso', 1.5);
  expect(spindleCapped(state, 10000, range)).toBe(true);
  state.program(51, 0);
  expect(spindleCapped(state, 10000, range)).toBe(false);
  expect(spindleCapped(state, 500, range)).toBe(true);
});
