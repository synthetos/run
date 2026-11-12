/**
 * JSON Schemas for the library records (MACHINING_ASSISTANT §2, §3, §4, §9).
 *
 * Written for the repository's own validator (`@synthetos/schema/json-schema`,
 * the one MachineProfile v2 uses), which keeps this package free of runtime
 * npm dependencies. That validator implements a fixed keyword set and throws
 * on any other, so these schemas use only those keywords; rules a JSON Schema
 * cannot state (per-type tool geometry, `min <= max`, exactly one of
 * `source`/`placeholder`, link sanitising) are checked in validate.ts.
 *
 * Every object is closed (`additionalProperties: false`) and every array and
 * string is bounded, so a record from storage, an import or the cloud cannot
 * carry anything the types do not name.
 */
import type { Schema } from '@synthetos/schema/json-schema';
import { deepFreeze } from './freeze.ts';
import { URL_MAX_LENGTH } from './url.ts';
import { COATINGS, MATERIAL_FAMILIES, SAFETY_SEVERITIES, TOOL_MATERIALS, TOOL_TYPES } from './types.ts';

/** A record id: lower-case token (`builtin.al-6061`) or a UUID. */
export const ID_PATTERN = '^[a-z0-9][a-z0-9._-]{0,63}$';
/** One line of plain text: no C0 or C1 controls, no bidi overrides or isolates. */
export const PLAIN_TEXT = '^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]*$';
/** Plain text that may also hold tabs and line feeds (descriptions and notes). */
export const MULTILINE_TEXT = '^[^\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]*$';
/** Our own image assets, as relative paths: no scheme, no host, no `..` segment. */
export const ASSET_PATH = '^(?:[a-z0-9][a-z0-9_-]*/)*[a-z0-9][a-z0-9_.-]*\\.(?:png|jpg|jpeg|webp|avif)$';
/** ISO 8601 calendar date (the day is checked in validate.ts). */
export const ISO_DATE = '^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$';
/** A fork edit path: a top-level field, or one field of a nested object (`physical.kc`). */
export const EDIT_PATH = '^[A-Za-z]+(?:\\.[A-Za-z]+)?$';

const text = (maxLength: number): Schema => ({ type: 'string', minLength: 1, maxLength, pattern: PLAIN_TEXT });
const optionalText = (maxLength: number): Schema => ({ type: 'string', maxLength, pattern: PLAIN_TEXT });
const notes = (maxLength: number): Schema => ({ type: 'string', maxLength, pattern: MULTILINE_TEXT });
const positive = (maximum: number): Schema => ({ type: 'number', exclusiveMinimum: 0, maximum });
const nonNegative = (maximum: number): Schema => ({ type: 'number', minimum: 0, maximum });
const coordinate: Schema = { type: 'number', minimum: -100_000, maximum: 100_000 };
const ID: Schema = { type: 'string', pattern: ID_PATTERN };
const VERSION: Schema = { type: 'integer', minimum: 1, maximum: 1_000_000_000 };
const COOLANT: Schema = { enum: ['none', 'air', 'mist', 'flood'] };
const CURRENCY: Schema = { type: 'string', pattern: '^[A-Z]{3}$' };
const URL_TEXT: Schema = { type: 'string', minLength: 1, maxLength: URL_MAX_LENGTH };
const XY: Schema = { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: coordinate, y: coordinate } };

/** `{ value, source }` or `{ value, placeholder: true, note? }` (exactly one is checked in validate.ts). */
const sourced = (value: Schema): Schema => ({
  type: 'object',
  additionalProperties: false,
  required: ['value'],
  properties: {
    value,
    source: { $ref: '#/$defs/citation' },
    placeholder: { const: true },
    note: text(300),
  },
});

const range = (maximum: number): Schema => ({
  type: 'object',
  additionalProperties: false,
  required: ['min', 'max'],
  properties: { min: positive(maximum), max: positive(maximum) },
});

/** Shared definitions; every root schema carries all of them (the validator resolves `$ref` against the root). */
const DEFS: Schema = {
  citation: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'title'],
    properties: {
      kind: { enum: ['manufacturer', 'handbook', 'synthetos', 'user', 'ai'] },
      title: text(200),
      version: text(64),
      locator: text(200),
    },
  },
  recordRef: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'version'],
    properties: { id: ID, version: VERSION },
  },
  purchaseLink: {
    type: 'object',
    additionalProperties: false,
    required: ['vendor', 'url', 'kind'],
    properties: {
      vendor: text(120),
      url: URL_TEXT,
      sku: text(64),
      price: nonNegative(10_000_000),
      currency: CURRENCY,
      boughtAt: { type: 'string', pattern: ISO_DATE },
      kind: { enum: ['store', 'link'] },
    },
  },
};

const root = (title: string, schema: Schema): Schema => deepFreeze({ title, ...schema, $defs: DEFS });

export const PURCHASE_LINK_SCHEMA: Schema = root('PurchaseLink', { $ref: '#/$defs/purchaseLink' });

export const TOOL_SCHEMA: Schema = root('Tool', {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'version', 'name', 'type', 'geometry', 'toolMaterial', 'coating', 'description', 'notes', 'purchase', 'cuttingData', 'life', 'tags', 'images'],
  properties: {
    id: ID,
    version: VERSION,
    name: optionalText(120),
    type: { enum: [...TOOL_TYPES] },
    geometry: {
      type: 'object',
      additionalProperties: false,
      required: ['diameter', 'shank', 'flutes', 'fluteLength', 'overallLength'],
      properties: {
        diameter: positive(300),
        shank: positive(100),
        flutes: { type: 'integer', minimum: 1, maximum: 32 },
        fluteLength: positive(500),
        overallLength: positive(1000),
        stickout: positive(1000),
        helix: nonNegative(90),
        cornerRadius: positive(150),
        vAngle: positive(180),
        tipWidth: nonNegative(100),
        pointAngle: positive(180),
      },
    },
    toolMaterial: { enum: [...TOOL_MATERIALS] },
    coating: { enum: [...COATINGS] },
    manufacturer: text(120),
    partNumber: text(64),
    description: notes(2000),
    notes: notes(4000),
    purchase: { type: 'array', maxItems: 20, items: { $ref: '#/$defs/purchaseLink' } },
    datasheetUrl: URL_TEXT,
    cuttingData: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['materialRef', 'fz', 'source', 'note'],
        properties: {
          materialName: text(120),
          sourceUrl: URL_TEXT,
          sourcePage: { type: 'integer', minimum: 1, maximum: 10000 },
          placeholder: { const: true },
          materialRef: { $ref: '#/$defs/recordRef' },
          vc: positive(5000),
          fz: positive(10),
          ap: positive(500),
          ae: positive(300),
          coolant: COOLANT,
          source: { enum: ['manufacturer', 'synthetos', 'user', 'ai'] },
          note: optionalText(500),
        },
      },
    },
    life: {
      type: 'object',
      additionalProperties: false,
      required: ['minutes', 'byMaterial'],
      properties: {
        minutes: nonNegative(100_000_000),
        byMaterial: {
          type: 'array',
          maxItems: 500,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['materialRef', 'minutes'],
            properties: { materialRef: { $ref: '#/$defs/recordRef' }, minutes: nonNegative(100_000_000) },
          },
        },
      },
    },
    firmwareSlot: {
      type: 'object',
      additionalProperties: false,
      required: ['t', 'lengthOffset'],
      properties: { t: { type: 'integer', minimum: 1, maximum: 999 }, lengthOffset: { type: 'number', minimum: -1000, maximum: 1000 } },
    },
    tags: { type: 'array', maxItems: 32, uniqueItems: true, items: text(40) },
    images: { type: 'array', maxItems: 16, uniqueItems: true, items: { type: 'string', maxLength: 200, pattern: ASSET_PATH } },
    forkOf: { $ref: '#/$defs/recordRef' },
  },
});

const ENGAGEMENT_LIMIT: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['ap', 'ae'],
  // Multiples of the tool diameter: radial engagement cannot exceed the diameter.
  properties: { ap: positive(10), ae: positive(1) },
};

export const MATERIAL_SCHEMA: Schema = root('Material', {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'version', 'name', 'family', 'grade', 'physical', 'cutting', 'coolant', 'behaviour', 'safety', 'stockForms', 'purchase', 'description', 'notes'],
  properties: {
    id: ID,
    version: VERSION,
    name: text(120),
    family: { enum: [...MATERIAL_FAMILIES] },
    grade: optionalText(120),
    physical: {
      type: 'object',
      additionalProperties: false,
      properties: {
        hardness: sourced({
          type: 'object',
          additionalProperties: false,
          required: ['value', 'scale'],
          properties: { value: positive(100_000), scale: { enum: ['HB', 'HRB', 'HRC', 'HRM', 'shore-D', 'janka-N'] } },
        }),
        density: sourced(positive(25)),
        kc: sourced(positive(10_000)),
      },
    },
    cutting: {
      type: 'array',
      maxItems: TOOL_MATERIALS.length,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['toolMaterial', 'vc', 'chipload', 'engagement'],
        properties: {
          toolMaterial: { enum: [...TOOL_MATERIALS] },
          vc: sourced(range(5000)),
          chipload: sourced({
            type: 'object',
            additionalProperties: false,
            required: ['kind'],
            properties: {
              kind: { enum: ['factor', 'curve'] },
              min: positive(1),
              max: positive(1),
              points: {
                type: 'array',
                maxItems: 32,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['d', 'min', 'max'],
                  properties: { d: positive(300), min: positive(10), max: positive(10) },
                },
              },
            },
          }),
          engagement: sourced({
            type: 'object',
            additionalProperties: false,
            required: ['hobby', 'medium', 'rigid'],
            properties: { hobby: ENGAGEMENT_LIMIT, medium: ENGAGEMENT_LIMIT, rigid: ENGAGEMENT_LIMIT },
          }),
        },
      },
    },
    coolant: {
      type: 'object',
      additionalProperties: false,
      required: ['need', 'reason'],
      properties: { need: { enum: ['required', 'recommended', 'none', 'avoid'] }, reason: optionalText(300) },
    },
    behaviour: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'text'],
        properties: { kind: { enum: ['melts', 'work-hardens', 'chip-evacuation', 'grain-direction'] }, text: text(300) },
      },
    },
    safety: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'text'],
        properties: { severity: { enum: [...SAFETY_SEVERITIES] }, text: text(300) },
      },
    },
    stockForms: {
      type: 'array',
      maxItems: 64,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: { kind: { enum: ['sheet', 'bar'] }, thickness: positive(1000), diameter: positive(1000) },
      },
    },
    purchase: { type: 'array', maxItems: 20, items: { $ref: '#/$defs/purchaseLink' } },
    description: notes(2000),
    notes: notes(4000),
    forkOf: { $ref: '#/$defs/recordRef' },
  },
});

export const STOCK_SCHEMA: Schema = root('Stock', {
  type: 'object',
  additionalProperties: false,
  required: ['shape', 'width', 'depth', 'thickness', 'materialRef', 'position', 'zero'],
  properties: {
    shape: { enum: ['block', 'round', 'sheet'] },
    width: positive(10_000),
    depth: positive(10_000),
    diameter: positive(10_000),
    thickness: positive(10_000),
    materialRef: { $ref: '#/$defs/recordRef' },
    position: XY,
    zero: {
      type: 'object',
      additionalProperties: false,
      required: ['corner', 'height'],
      properties: {
        corner: { enum: ['front-left', 'front-right', 'back-left', 'back-right', 'center'] },
        height: { enum: ['top', 'bottom'] },
      },
    },
  },
});

const pair = (length: number): Schema => ({ type: 'array', minItems: length, maxItems: length, items: coordinate });

export const FIXTURE_SCHEMA: Schema = root('Fixture', {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'source', 'outline', 'holes', 'height', 'position', 'material'],
  properties: {
    id: ID,
    name: text(120),
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['file', 'kind', 'hash'],
      properties: { file: text(255), kind: { enum: ['dxf', 'svg'] }, hash: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
    },
    outline: { type: 'array', minItems: 3, maxItems: 100_000, items: pair(2) },
    holes: { type: 'array', maxItems: 10_000, items: pair(3) },
    height: positive(1000),
    position: XY,
    material: text(120),
    clamps: {
      type: 'array',
      maxItems: 64,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'x', 'y', 'w', 'd', 'h'],
        properties: { kind: text(40), x: coordinate, y: coordinate, w: positive(10_000), d: positive(10_000), h: positive(1000) },
      },
    },
  },
});

export const STORE_PRODUCT_SCHEMA: Schema = root('StoreProduct', {
  type: 'object',
  additionalProperties: false,
  required: ['sku', 'title', 'price', 'currency', 'stockState', 'images', 'spec'],
  properties: {
    sku: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' },
    title: text(200),
    price: nonNegative(1_000_000),
    currency: CURRENCY,
    stockState: { enum: ['in-stock', 'low-stock', 'out-of-stock', 'preorder'] },
    images: { type: 'array', maxItems: 16, uniqueItems: true, items: { type: 'string', maxLength: 200, pattern: ASSET_PATH } },
    spec: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'id', 'version'],
      properties: { kind: { enum: ['tool', 'material'] }, id: ID, version: VERSION },
    },
  },
});

export const FORK_SCHEMA: Schema = root('LibraryFork', {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id', 'version', 'forkOf', 'edits'],
  properties: {
    kind: { enum: ['tool', 'material'] },
    id: ID,
    version: VERSION,
    forkOf: { $ref: '#/$defs/recordRef' },
    edits: { type: 'object', maxProperties: 64, propertyNames: { type: 'string', pattern: EDIT_PATH } },
  },
});
