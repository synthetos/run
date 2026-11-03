import { describe, expect, it } from 'vitest';
import { guidedAxes, GUIDED_AXIS_FIELDS } from '../src/workspace/settings/GuidedSettings.ts';
import { writableKey } from '../src/workspace/settings/pending.ts';
import type { MachineProfile } from '../src/workspace/library.ts';

describe('guided controller settings', () => {
  const machine: MachineProfile = { id: 'xyz', name: 'XYZ router', templateId: 'custom', drive: 'belt', travel: { x: 300, y: 200, z: 60 }, spindle: '', createdAt: '' };

  it('uses the profile axes, even if an unused A axis is enabled in the board defaults', () => {
    expect(guidedAxes(machine, { aam: 1, bam: 1, cam: 1 })).toEqual(['x', 'y', 'z']);
    expect(guidedAxes({ ...machine, axes: { a: {} } }, { aam: 1 })).toEqual(['x', 'y', 'z', 'a']);
    expect(guidedAxes(null, { aam: 1 })).toEqual(['x', 'y', 'z', 'a']);
    expect(guidedAxes(null, {})).toEqual(['x', 'y', 'z']);
  });

  it('uses reviewed keys and preserves the firmware write boundary', () => {
    for (const dialect of ['tinyg-en']) {
      expect(writableKey('gun', dialect)).toBe(true);
      for (const axis of ['x', 'y', 'z', 'a']) {
        for (const [suffix] of GUIDED_AXIS_FIELDS) expect(writableKey(`${axis}${suffix}`, dialect), `${dialect}: ${axis}${suffix}`).toBe(true);
      }
    }
    expect(writableKey('gun', 'tinyg-440')).toBe(false);
    expect(writableKey('xfr', 'tinyg-440')).toBe(false);
  });
});
