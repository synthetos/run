/**
 * The web app reads setting names, value words and units from the settings
 * files (Board settings spec §4.3): no label tables in UI code.
 */
import { describe, expect, it } from 'vitest';
import { settingsReadGroups } from '@synthetos/schema';
import { plainValue, settingMeta } from '../src/workspace/boardFacts.ts';
import { defsFor, definitionOf } from '../src/workspace/settings/defs.ts';
import type { LiveView } from '../src/workspace/model.ts';

const S449 = 'tinyg-449-stock';

describe('settingMeta and plainValue read the definitions', () => {
  it('449: 1mi 2 reads "Half step (2)"', () => expect(plainValue('1mi', 2, S449)).toBe('Half step (2)'));

  it('449: xsn 4 reads "Probe"; gun 1 reads "Millimetres (G21)"', () => {
    expect(plainValue('xsn', 4, S449)).toBe('Probe');
    expect(plainValue('gun', 1, S449)).toBe('Millimetres (G21)');
  });

  it('449: 1mi 3 reads "Unknown value (3)"', () => expect(plainValue('1mi', 3, S449)).toBe('Unknown value (3)'));

  it('449: coph has no definition', () => {
    expect(settingMeta('coph', S449).access).toBeNull();
    expect(settingMeta('coph', S449).label).toBe('coph');
  });

  it('every read-group member of every dialect with a file has a label that is not its token', () => {
    for (const d of ['tinyg-en', 'tinyg-440', S449]) {
      for (const k of settingsReadGroups(d).flatMap((g) => g.members)) expect({ d, k, plain: settingMeta(k, d).label !== k }).toEqual({ d, k, plain: true });
    }
  });

  it('a dialect without a file returns the token as label and null access', () => {
    expect(settingMeta('xsn', 'g2core-edge').label).toBe('xsn');
    expect(settingMeta('xsn', 'g2core-edge').access).toBeNull();
    expect(plainValue('xsn', 3, 'g2core-edge')).toBe('3');
  });

  it('carries short name, access, reason and token', () => {
    expect(settingMeta('2mi', 'tinyg-en')).toMatchObject({ key: '2mi', token: '2mi', label: 'Motor 2 microsteps', short: 'Microsteps', access: 'write', hwAllowed: [1, 2, 4, 8] });
    expect(settingMeta('ex', 'tinyg-en')).toMatchObject({ access: 'forbidden', reason: "Run's sending depends on it, so Run never writes it." });
  });

  it('units come from the data and read as words', () => {
    expect(plainValue('1sa', 1.8, 'tinyg-en')).toBe('1.8° per step');
    expect(plainValue('1tr', 1.25, 'tinyg-en')).toBe('1.25 mm');
    expect(plainValue('xjm', 20, 'tinyg-en')).toBe('20 million mm/min³');
    expect(plainValue('avm', 230400, 'tinyg-en')).toBe('230 400 °/min');
    expect(plainValue('atn', -1, 'tinyg-en')).toBe('-1°');
    expect(plainValue('si', 250, 'tinyg-en')).toBe('250 ms');
    expect(settingMeta('xjm', 'tinyg-en').unit).toBe('million mm/min³');
  });

  it('a value outside the defined list never crashes and never picks a neighbour', () => {
    expect(plainValue('xsn', 5, 'tinyg-en')).toBe('Unknown value (5)');
    expect(plainValue('xvm', undefined, 'tinyg-en')).toBeNull();
    expect(plainValue('id', '1H2345', 'tinyg-en')).toBe('1H2345');
  });
});

describe('defs.ts picks the file from the live view', () => {
  const view = (dialectId: string | null, fb?: number): LiveView =>
    ({ readout: { dialectId, phase: { kind: 'idle' }, settings: {} }, message: fb === undefined ? null : { snapshot: { identity: { fb } } } }) as unknown as LiveView;

  it('uses the classified dialect and the board build', () => {
    expect(defsFor(view('tinyg-en', 450.06))?.tokens.has('sso')).toBe(true);
    expect(defsFor(view('tinyg-en', 450.02))?.tokens.has('sso')).toBe(false);
    expect(defsFor(view(S449))?.dialect).toBe(S449);
  });

  it('no view or no dialect file gives null', () => {
    expect(defsFor(null)).toBeNull();
    expect(defsFor(view(null))).toBeNull();
    expect(defsFor(view('g2core-edge'))).toBeNull();
    expect(definitionOf('xsn', view('g2core-edge'))).toBeNull();
    expect(definitionOf('xsn', view(S449))?.label).toBe('X minimum switch mode');
  });
});
