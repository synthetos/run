/**
 * Golden migration (Board settings spec §4.4 item 2, §7 item 1): the reviewed
 * edge-next overlay moved from TypeScript into settings/tinyg-450.json. The
 * golden was frozen from the tree before the move (fixture `$comment`). Every
 * reviewed write field, label, description, unit, value number and source line
 * must be unchanged; only the words of enumerated values may improve (they
 * name a value, they do not decide whether a write is allowed).
 *
 * Safety review: the reviewer confirms the golden was taken from the pre-change tree.
 */
import { describe, expect, it } from 'vitest';
import { overlayFromDefs, requireSettingsDefs, settingsDefsFor, settingsSchemaFor } from '../src/index.ts';
import type { OverlayEntry } from '../src/index.ts';
import golden from './fixtures/settings/overlay-golden.json' with { type: 'json' };

type Entry = Record<string, unknown>;

/** The entry with its value words removed and every other field kept. */
function reviewed(o: OverlayEntry | Entry): Entry {
  const e = { ...(o as Entry) };
  const values = e['values'] as readonly { value: number }[] | undefined;
  if (values !== undefined) e['values'] = values.map((v) => v.value);
  return e;
}

function byKey(list: readonly (OverlayEntry | Entry)[]): Entry[] {
  return list.map(reviewed).sort((a, b) => String(a['key']).localeCompare(String(b['key'])));
}

describe('tinyg-450.json carries the reviewed overlay', () => {
  it('every reviewed write field is unchanged by the move to JSON', () => {
    expect(byKey(overlayFromDefs(settingsDefsFor('tinyg-en')!))).toEqual(byKey(golden.base));
  });

  it('the same 106 keys are writable, no more', () => {
    expect(overlayFromDefs(settingsDefsFor('tinyg-en')!).map((o) => o.key).sort()).toEqual(golden.base.map((o) => o.key).sort());
    expect(golden.base).toHaveLength(106);
  });

  it.each([450.02, 450.05, 450.06])('the %s schema keys are unchanged', (fb) => {
    expect([...settingsSchemaFor('tinyg-en', fb).settings.keys()].sort()).toEqual(golden.keysByFb[String(fb) as keyof typeof golden.keysByFb]);
  });

  it.each([450.05, 450.06])('the %s schema writes exactly the reviewed keys', (fb) => {
    const written = [...settingsSchemaFor('tinyg-en', fb).settings.values()].filter((d) => d.overlay !== undefined).map((d) => reviewed(d.overlay as OverlayEntry));
    expect(written.sort((a, b) => String(a['key']).localeCompare(String(b['key'])))).toEqual(byKey(golden.base));
  });

  it('the schemaKey strings are unchanged', () => {
    for (const [fb, key] of Object.entries(golden.schemaKeys)) expect(settingsSchemaFor('tinyg-en', Number(fb)).schemaKey).toBe(key);
  });

  it('overlayFromDefs refuses a source that is not an EN cfgArray row', () => {
    const f = settingsDefsFor('tinyg-en')!;
    const def = f.tokens.get('xvm')!;
    const bad = { ...f, tokens: new Map([['xvm', { ...def, src: 'TG config_app.c:12' }]]) };
    expect(() => overlayFromDefs(bad)).toThrow(/xvm: overlay source must be an EN row/);
  });

  it('overlayFromDefs refuses a write on a describe-only unit', () => {
    const f = settingsDefsFor('tinyg-en')!;
    const bad = { ...f, tokens: new Map([['xvm', { ...f.tokens.get('xvm')!, unit: 'Hz' as const }]]) };
    expect(() => overlayFromDefs(bad)).toThrow(/xvm: unit Hz is never written/);
  });

  it('requireSettingsDefs refuses a dialect without a file', () => {
    expect(() => requireSettingsDefs('g2core-edge')).toThrow(/no settings file for dialect "g2core-edge"/);
    expect(requireSettingsDefs('tinyg-en', 450.06).dialect).toBe('tinyg-en');
  });
});
