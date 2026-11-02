/** Valid records for the tests; each test changes one thing. */
import type { Fixture, Material, Stock, StoreProduct, Tool } from '../src/index.ts';

export const CITED = { kind: 'manufacturer', title: 'Example datasheet', version: 'rev 3', locator: 'table 2' } as const;

export function tool(overrides: Partial<Record<keyof Tool, unknown>> = {}): Tool {
  return {
    id: 'tool-1',
    version: 1,
    name: '¼ in 2-flute up-cut',
    type: 'flat',
    geometry: { diameter: 6.35, shank: 6.35, flutes: 2, fluteLength: 22, overallLength: 64, stickout: 30, helix: 30 },
    toolMaterial: 'carbide',
    coating: 'uncoated',
    manufacturer: 'Example Tools',
    partNumber: 'EX-250-2',
    description: 'General purpose.\nUp-cut.',
    notes: 'chatters above 18k in oak',
    purchase: [{ vendor: 'Example Tools', url: 'https://shop.example.com/ex-250-2', sku: 'EX-250-2', price: 19.5, currency: 'USD', boughtAt: '2026-10-01', kind: 'link' }],
    datasheetUrl: 'https://example.com/datasheets/ex-250-2.pdf',
    cuttingData: [
      { materialRef: { id: 'builtin.al-6061', version: 1 }, vc: 200, fz: 0.03, ap: 1.5, ae: 3, coolant: 'air', source: 'manufacturer', note: '' },
    ],
    life: { minutes: 12, byMaterial: [{ materialRef: { id: 'builtin.al-6061', version: 1 }, minutes: 12 }] },
    firmwareSlot: { t: 1, lengthOffset: 0 },
    tags: ['aluminium', 'roughing'],
    images: ['tools/ex-250-2.webp'],
    ...overrides,
  } as Tool;
}

export function material(overrides: Partial<Record<keyof Material, unknown>> = {}): Material {
  return {
    id: 'mine.al',
    version: 1,
    name: 'My aluminium',
    family: 'aluminium',
    grade: '6061-T6',
    physical: { hardness: { value: { value: 95, scale: 'HB' }, source: CITED }, density: { value: 2.7, source: CITED }, kc: { value: 800, placeholder: true, note: 'to measure' } },
    cutting: [
      {
        toolMaterial: 'carbide',
        vc: { value: { min: 120, max: 300 }, source: CITED },
        chipload: { value: { kind: 'factor', min: 0.004, max: 0.008 }, source: CITED },
        engagement: {
          value: { hobby: { ap: 0.25, ae: 0.25 }, medium: { ap: 0.5, ae: 0.5 }, rigid: { ap: 1, ae: 1 } },
          source: CITED,
        },
      },
    ],
    coolant: { need: 'required', reason: 'Aluminium welds to the flutes without air or mist.' },
    behaviour: [{ kind: 'chip-evacuation', text: 'Clear the chips.' }],
    safety: [{ severity: 'caution', text: 'Sharp chips.' }],
    stockForms: [{ kind: 'sheet', thickness: 6 }, { kind: 'bar', diameter: 20 }],
    purchase: [],
    description: '',
    notes: '',
    ...overrides,
  } as Material;
}

export function stock(overrides: Partial<Record<keyof Stock, unknown>> = {}): Stock {
  return {
    shape: 'block',
    width: 100,
    depth: 80,
    thickness: 12,
    materialRef: { id: 'builtin.al-6061', version: 1 },
    position: { x: 10, y: 10 },
    zero: { corner: 'front-left', height: 'top' },
    ...overrides,
  } as Stock;
}

export function fixture(overrides: Partial<Record<keyof Fixture, unknown>> = {}): Fixture {
  return {
    id: 'fixture-1',
    name: 'Vise plate',
    source: { file: 'plate.dxf', kind: 'dxf', hash: 'a'.repeat(64) },
    outline: [
      [0, 0],
      [100, 0],
      [100, 50],
    ],
    holes: [[10, 10, 3]],
    height: 12,
    position: { x: 0, y: 0 },
    material: 'Aluminium',
    clamps: [{ kind: 'strap', x: 5, y: 5, w: 20, d: 10, h: 15 }],
    ...overrides,
  } as Fixture;
}

export function product(overrides: Partial<Record<keyof StoreProduct, unknown>> = {}): StoreProduct {
  return {
    sku: 'EM-3175-2F',
    title: '3.175 mm 2-flute end mill',
    price: 12,
    currency: 'USD',
    stockState: 'in-stock',
    images: ['store/em-3175-2f.webp'],
    spec: { kind: 'tool', id: 'store.em-3175-2f', version: 2 },
    ...overrides,
  } as StoreProduct;
}

/** A deep, mutable copy. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
