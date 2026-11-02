/**
 * Runtime validation of library records (MACHINING_ASSISTANT §2, §3, §4, §8;
 * WORKSPACE_FEATURES Stock and Fixture): exactly the fields of the doc's
 * tables, closed shapes, and the rules a JSON Schema cannot state.
 */
import { describe, expect, it } from 'vitest';
import {
  TOOL_TYPES,
  TOOL_TYPE_GEOMETRY,
  readFixture,
  readMaterial,
  readPurchaseLink,
  readStock,
  readStoreProduct,
  readTool,
  type LibraryResult,
} from '../src/index.ts';
import { CITED, clone, fixture, material, product, stock, tool } from './fixtures.ts';

function issuesOf<T>(r: LibraryResult<T>): { path: string; message: string }[] {
  return r.ok ? [] : [...r.issues];
}

function expectIssue<T>(r: LibraryResult<T>, path: string, message?: RegExp): void {
  expect(r.ok, JSON.stringify(r)).toBe(false);
  const found = issuesOf(r).filter((i) => i.path === path);
  expect(found.length, `${path} in ${JSON.stringify(issuesOf(r))}`).toBeGreaterThan(0);
  if (message !== undefined) expect(found.some((i) => message.test(i.message)), JSON.stringify(found)).toBe(true);
}

describe('readTool', () => {
  it('accepts a complete tool and returns a frozen, detached copy', () => {
    const input = tool();
    const r = readTool(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual(input);
    expect(r.value).not.toBe(input);
    expect(Object.isFrozen(r.value.geometry)).toBe(true);
    expect(Object.isFrozen(r.value.purchase[0])).toBe(true);
  });

  it('accepts the minimum: no optional field', () => {
    const t = clone(tool()) as unknown as Record<string, unknown>;
    for (const k of ['manufacturer', 'partNumber', 'datasheetUrl', 'firmwareSlot']) delete t[k];
    t['geometry'] = { diameter: 3.175, shank: 3.175, flutes: 2, fluteLength: 12, overallLength: 38 };
    t['purchase'] = [];
    t['cuttingData'] = [];
    t['tags'] = [];
    t['images'] = [];
    t['life'] = { minutes: 0, byMaterial: [] };
    expect(readTool(t).ok).toBe(true);
  });

  it('refuses unknown fields anywhere (closed shapes)', () => {
    expectIssue(readTool({ ...tool(), facts: [] }), '/facts', /not allowed/);
    expectIssue(readTool(tool({ geometry: { ...tool().geometry, colour: 'red' } })), '/geometry/colour');
    expectIssue(readTool(tool({ purchase: [{ ...tool().purchase[0], token: 'x' }] })), '/purchase/0/token');
  });

  it('refuses missing required fields, wrong types and out-of-range numbers', () => {
    const t = clone(tool()) as unknown as Record<string, unknown>;
    delete t['notes'];
    expectIssue(readTool(t), '', /missing required property "notes"/);
    expectIssue(readTool(tool({ version: 0 })), '/version');
    expectIssue(readTool(tool({ version: 1.5 })), '/version');
    expectIssue(readTool(tool({ type: 'spoon' })), '/type');
    expectIssue(readTool(tool({ coating: 'gold' })), '/coating');
    expectIssue(readTool(tool({ toolMaterial: 'diamond' })), '/toolMaterial');
    expectIssue(readTool(tool({ id: 'Has Spaces' })), '/id');
    expectIssue(readTool(tool({ name: '' })), '/name');
    expectIssue(readTool(tool({ name: 'a\u202eb' })), '/name');
    expectIssue(readTool(tool({ notes: 'line\u0007' })), '/notes');
    expect(readTool(tool({ notes: 'two\nlines\tok' })).ok).toBe(true);
    expectIssue(readTool(tool({ geometry: { ...tool().geometry, diameter: 0 } })), '/geometry/diameter');
    expectIssue(readTool(tool({ geometry: { ...tool().geometry, diameter: Number.NaN } })), '/geometry/diameter');
    expectIssue(readTool(tool({ geometry: { ...tool().geometry, flutes: 2.5 } })), '/geometry/flutes');
    expectIssue(readTool(tool({ tags: ['a', 'a'] })), '/tags', /unique/);
    expectIssue(readTool(tool({ images: ['https://example.com/a.png'] })), '/images/0');
    expectIssue(readTool(tool({ images: ['../secret.png'] })), '/images/0');
    expectIssue(readTool(tool({ images: ['/abs.png'] })), '/images/0');
    expectIssue(readTool(tool({ images: ['data:image/png;base64,AAAA'] })), '/images/0');
    expectIssue(readTool(tool({ firmwareSlot: { t: 0, lengthOffset: 0 } })), '/firmwareSlot/t');
    expectIssue(readTool(tool({ forkOf: { id: 'x' } })), '/forkOf');
    expect(readTool(tool({ forkOf: { id: 'builtin.flat', version: 3 } })).ok).toBe(true);
    expectIssue(readTool(null), '');
    expectIssue(readTool([]), '');
  });

  it('checks per-type geometry for every tool type', () => {
    const base = { diameter: 6, shank: 6, flutes: 2, fluteLength: 20, overallLength: 50 };
    const values = { cornerRadius: 1, vAngle: 60, tipWidth: 0.2, pointAngle: 118 } as const;
    for (const type of TOOL_TYPES) {
      const spec = TOOL_TYPE_GEOMETRY[type];
      const geometry: Record<string, number> = { ...base };
      for (const f of [...spec.required, ...spec.optional]) geometry[f] = values[f];
      expect(readTool(tool({ type, geometry })).ok, type).toBe(true);
      for (const f of spec.required) {
        const missing = { ...geometry };
        delete missing[f];
        expectIssue(readTool(tool({ type, geometry: missing })), '/geometry', new RegExp(`needs ${f}`));
      }
      for (const f of Object.keys(values) as (keyof typeof values)[]) {
        if (spec.required.includes(f) || spec.optional.includes(f)) continue;
        expectIssue(readTool(tool({ type, geometry: { ...geometry, [f]: values[f] } })), `/geometry/${f}`, new RegExp(`has no ${f}`));
      }
    }
  });

  it('checks geometry consistency', () => {
    const g = tool().geometry;
    expectIssue(readTool(tool({ type: 'bull-nose', geometry: { ...g, cornerRadius: 3.2 } })), '/geometry/cornerRadius');
    expect(readTool(tool({ type: 'bull-nose', geometry: { ...g, cornerRadius: 3.175 } })).ok).toBe(true);
    expectIssue(readTool(tool({ type: 'v-bit', geometry: { ...g, vAngle: 180 } })), '/geometry/vAngle');
    expectIssue(readTool(tool({ type: 'v-bit', geometry: { ...g, vAngle: 90, tipWidth: 6.35 } })), '/geometry/tipWidth');
    expectIssue(readTool(tool({ type: 'drill', geometry: { ...g, pointAngle: 180 } })), '/geometry/pointAngle');
    expectIssue(readTool(tool({ geometry: { ...g, fluteLength: 65 } })), '/geometry/fluteLength');
    expectIssue(readTool(tool({ geometry: { ...g, stickout: 65 } })), '/geometry/stickout');
  });

  it('sanitises purchase and datasheet links (§8)', () => {
    const link = tool().purchase[0];
    expectIssue(readTool(tool({ datasheetUrl: 'javascript:alert(1)' })), '/datasheetUrl', /Only http and https/);
    expectIssue(readTool(tool({ purchase: [{ ...link, url: 'https://u:p@shop.example.com/' }] })), '/purchase/0/url', /user name or password/);
    expectIssue(readTool(tool({ purchase: [{ ...link, url: 'data:text/plain,x' }] })), '/purchase/0/url');
    expectIssue(readTool(tool({ datasheetUrl: `https://example.com/${'a'.repeat(2100)}` })), '/datasheetUrl', /longer than/);
  });

  it('checks cutting data and tool life', () => {
    const c = tool().cuttingData[0];
    expectIssue(readTool(tool({ cuttingData: [{ ...c, ae: 7 }] })), '/cuttingData/0/ae', /larger than the tool diameter/);
    expectIssue(readTool(tool({ cuttingData: [{ ...c, source: 'forum' }] })), '/cuttingData/0/source');
    expectIssue(readTool(tool({ cuttingData: [{ ...c, coolant: 'oil' }] })), '/cuttingData/0/coolant');
    const ref = { id: 'builtin.mdf', version: 1 };
    expectIssue(readTool(tool({ life: { minutes: 3, byMaterial: [{ materialRef: ref, minutes: 1 }, { materialRef: { ...ref, version: 2 }, minutes: 2 }] } })), '/life/byMaterial/1', /listed twice/);
  });
});

describe('readPurchaseLink', () => {
  const link = tool().purchase[0];

  it('accepts a link and the store kind with no optional field', () => {
    expect(readPurchaseLink(link).ok).toBe(true);
    expect(readPurchaseLink({ vendor: 'Synthetos', url: 'https://synthetos.example/p', kind: 'store' }).ok).toBe(true);
  });

  it('needs a currency with a price, a real date and a valid kind', () => {
    const { currency: _c, ...noCurrency } = link as unknown as Record<string, unknown>;
    expectIssue(readPurchaseLink(noCurrency), '/currency', /needs its currency/);
    expectIssue(readPurchaseLink({ ...link, boughtAt: '2026-02-30' }), '/boughtAt', /not a calendar date/);
    expectIssue(readPurchaseLink({ ...link, boughtAt: '2026-13-01' }), '/boughtAt');
    expect(readPurchaseLink({ ...link, boughtAt: '2024-02-29' }).ok).toBe(true);
    expectIssue(readPurchaseLink({ ...link, currency: 'usd' }), '/currency');
    expectIssue(readPurchaseLink({ ...link, price: -1 }), '/price');
    expectIssue(readPurchaseLink({ ...link, kind: 'affiliate' }), '/kind');
    expectIssue(readPurchaseLink({ ...link, url: 'ftp://example.com/x' }), '/url', /Only http and https/);
  });
});

describe('readMaterial', () => {
  it('accepts a complete material and freezes it', () => {
    const r = readMaterial(material());
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(Object.isFrozen(r.value.cutting[0]?.engagement.value.hobby)).toBe(true);
  });

  it('accepts a chipload curve and an empty physical block', () => {
    const cut = material().cutting[0];
    const curve = { value: { kind: 'curve', points: [{ d: 3, min: 0.01, max: 0.02 }, { d: 6, min: 0.02, max: 0.04 }] }, source: CITED };
    expect(readMaterial(material({ physical: {}, cutting: [{ ...cut, chipload: curve }] })).ok).toBe(true);
  });

  it('needs exactly one of source and placeholder on every sourced value', () => {
    const p = material().physical;
    expectIssue(readMaterial(material({ physical: { ...p, kc: { value: 800 } } })), '/physical/kc', /exactly one/);
    expectIssue(readMaterial(material({ physical: { ...p, density: { value: 2.7, source: CITED, placeholder: true } } })), '/physical/density', /exactly one/);
    expectIssue(readMaterial(material({ physical: { ...p, density: { value: 2.7, source: CITED, note: 'x' } } })), '/physical/density/note', /only a placeholder/);
    expectIssue(readMaterial(material({ physical: { ...p, hardness: { value: { value: 95, scale: 'HB' } } } })), '/physical/hardness');
    expectIssue(readMaterial(material({ physical: { ...p, kc: { value: 800, placeholder: false } } })), '/physical/kc/placeholder');
    const cut = material().cutting[0];
    for (const key of ['vc', 'chipload', 'engagement'] as const) {
      const bare = { value: (cut as unknown as Record<string, { value: unknown }>)[key]?.value };
      expectIssue(readMaterial(material({ cutting: [{ ...cut, [key]: bare }] })), `/cutting/0/${key}`, /exactly one/);
    }
    expectIssue(readMaterial(material({ physical: { ...p, kc: { value: 800, source: { kind: 'forum', title: 'x' } } } })), '/physical/kc/source/kind');
  });

  it('checks ranges, chipload shapes and one entry per tool material', () => {
    const cut = material().cutting[0] as unknown as Record<string, unknown>;
    expectIssue(readMaterial(material({ cutting: [{ ...cut, vc: { value: { min: 300, max: 120 }, source: CITED } }] })), '/cutting/0/vc/value', /reversed/);
    const factor = (v: unknown) => material({ cutting: [{ ...cut, chipload: { value: v, source: CITED } }] });
    expectIssue(readMaterial(factor({ kind: 'factor', min: 0.008, max: 0.004 })), '/cutting/0/chipload/value', /reversed/);
    expectIssue(readMaterial(factor({ kind: 'factor', min: 0.004 })), '/cutting/0/chipload/value', /min and max/);
    expectIssue(readMaterial(factor({ kind: 'factor', max: 0.004 })), '/cutting/0/chipload/value', /min and max/);
    expectIssue(readMaterial(factor({ kind: 'factor', min: 0.004, max: 0.008, points: [] })), '/cutting/0/chipload/value', /no points/);
    const p1 = { d: 3, min: 0.01, max: 0.02 };
    const p2 = { d: 6, min: 0.02, max: 0.04 };
    expectIssue(readMaterial(factor({ kind: 'curve' })), '/cutting/0/chipload/value', /two or more points/);
    expectIssue(readMaterial(factor({ kind: 'curve', points: [p1] })), '/cutting/0/chipload/value', /two or more points/);
    expectIssue(readMaterial(factor({ kind: 'curve', points: [p1, p2], min: 0.01 })), '/cutting/0/chipload/value', /no min or max/);
    expectIssue(readMaterial(factor({ kind: 'curve', points: [p1, p2], max: 0.01 })), '/cutting/0/chipload/value', /no min or max/);
    expectIssue(readMaterial(factor({ kind: 'curve', points: [p1, { ...p2, min: 0.05 }] })), '/cutting/0/chipload/value/points/1', /reversed/);
    expectIssue(readMaterial(factor({ kind: 'curve', points: [p2, p1] })), '/cutting/0/chipload/value/points/1', /rise in diameter/);
    expectIssue(readMaterial(factor({ kind: 'curve', points: [p1, { ...p2, d: 3 }] })), '/cutting/0/chipload/value/points/1', /rise in diameter/);
    expectIssue(readMaterial(material({ cutting: [cut, cut] })), '/cutting/1/toolMaterial', /already has cutting data/);
    expectIssue(readMaterial(material({ cutting: [cut, { ...cut, toolMaterial: 'hss' }, { ...cut, toolMaterial: 'cobalt' }, cut] })), '/cutting', /more than 3/);
    const e = { value: { hobby: { ap: 0.25, ae: 1.5 }, medium: { ap: 0.5, ae: 0.5 }, rigid: { ap: 1, ae: 1 } }, source: CITED };
    expectIssue(readMaterial(material({ cutting: [{ ...cut, engagement: e }] })), '/cutting/0/engagement/value/hobby/ae');
  });

  it('a do-not-machine material has no cutting data', () => {
    const dnm = [{ severity: 'do-not-machine', text: 'Do not machine PVC.' }];
    expectIssue(readMaterial(material({ safety: dnm })), '/cutting', /do-not-machine/);
    expect(readMaterial(material({ safety: dnm, cutting: [] })).ok).toBe(true);
    expectIssue(readMaterial(material({ safety: [{ severity: 'meh', text: 'x' }] })), '/safety/0/severity');
    expectIssue(readMaterial(material({ safety: [{ severity: 'hazard', text: '' }] })), '/safety/0/text');
  });

  it('checks stock forms, families, coolant and behaviour', () => {
    expectIssue(readMaterial(material({ stockForms: [{ kind: 'sheet' }] })), '/stockForms/0', /a sheet has a thickness/);
    expectIssue(readMaterial(material({ stockForms: [{ kind: 'sheet', thickness: 3, diameter: 3 }] })), '/stockForms/0');
    expectIssue(readMaterial(material({ stockForms: [{ kind: 'bar', thickness: 3 }] })), '/stockForms/0', /a bar has a diameter/);
    expectIssue(readMaterial(material({ family: 'magnesium' })), '/family');
    expectIssue(readMaterial(material({ coolant: { need: 'sometimes', reason: '' } })), '/coolant/need');
    expectIssue(readMaterial(material({ behaviour: [{ kind: 'smells', text: 'x' }] })), '/behaviour/0/kind');
    expectIssue(readMaterial(material({ purchase: [{ vendor: 'x', url: 'javascript:void(0)', kind: 'link' }] })), '/purchase/0/url');
  });
});

describe('readStock', () => {
  it('accepts block, sheet and round stock', () => {
    expect(readStock(stock()).ok).toBe(true);
    expect(readStock(stock({ shape: 'sheet' })).ok).toBe(true);
    expect(readStock(stock({ shape: 'round', diameter: 25 })).ok).toBe(true);
  });

  it('round stock, and only round stock, has a diameter; the material is referenced by id and version', () => {
    expectIssue(readStock(stock({ shape: 'round' })), '/diameter');
    expectIssue(readStock(stock({ diameter: 25 })), '/diameter');
    expectIssue(readStock(stock({ materialRef: { id: 'builtin.al-6061' } })), '/materialRef');
    expectIssue(readStock(stock({ zero: { corner: 'middle', height: 'top' } })), '/zero/corner');
    expectIssue(readStock(stock({ width: -1 })), '/width');
  });
});

describe('readFixture', () => {
  it('accepts a fixture with and without clamps', () => {
    expect(readFixture(fixture()).ok).toBe(true);
    const { clamps: _c, ...noClamps } = fixture() as unknown as Record<string, unknown>;
    expect(readFixture(noClamps).ok).toBe(true);
  });

  it('checks outline points, holes, the file hash and clamps', () => {
    expectIssue(readFixture(fixture({ outline: [[0, 0], [1, 1]] })), '/outline', /fewer than 3/);
    expectIssue(readFixture(fixture({ outline: [[0, 0], [1, 1], [2]] })), '/outline/2');
    expectIssue(readFixture(fixture({ holes: [[1, 1, 0]] })), '/holes/0/2', /radius/);
    expectIssue(readFixture(fixture({ holes: [[1, 1, -2]] })), '/holes/0/2');
    expectIssue(readFixture(fixture({ source: { file: 'a.dxf', kind: 'dxf', hash: 'zz' } })), '/source/hash');
    expectIssue(readFixture(fixture({ source: { file: 'a.step', kind: 'step', hash: 'a'.repeat(64) } })), '/source/kind');
    expectIssue(readFixture(fixture({ clamps: [{ kind: 'strap', x: 0, y: 0, w: 0, d: 1, h: 1 }] })), '/clamps/0/w');
  });
});

describe('readStoreProduct', () => {
  it('accepts a product that links a versioned spec', () => {
    expect(readStoreProduct(product()).ok).toBe(true);
    expect(readStoreProduct(product({ spec: { kind: 'material', id: 'builtin.acrylic-cast', version: 1 }, stockState: 'preorder' })).ok).toBe(true);
  });

  it('serves only our own images (no hotlinking) and checks the spec reference', () => {
    expectIssue(readStoreProduct(product({ images: ['https://cdn.example.com/a.png'] })), '/images/0');
    expectIssue(readStoreProduct(product({ images: ['//cdn.example.com/a.png'] })), '/images/0');
    expectIssue(readStoreProduct(product({ images: ['store/a.svg'] })), '/images/0');
    expectIssue(readStoreProduct(product({ spec: { kind: 'tool', id: 'x' } })), '/spec');
    expectIssue(readStoreProduct(product({ spec: { kind: 'gift-card', id: 'x', version: 1 } })), '/spec/kind');
    expectIssue(readStoreProduct(product({ stockState: 'maybe' })), '/stockState');
    expectIssue(readStoreProduct(product({ sku: ' bad' })), '/sku');
    expectIssue(readStoreProduct(product({ price: Number.POSITIVE_INFINITY })), '/price');
  });
});
