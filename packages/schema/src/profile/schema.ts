/**
 * The stored and exported MachineProfile schemas (ROADMAP TB-01; RUN_PLAN
 * §7.2; SAFETY §4.10 rule 3, T-S47 precursor).
 *
 * Written for this package's own validator (`../jsonSchema.ts`), because
 * `schema` keeps zero runtime npm dependencies (RUN_PLAN §5.3); see the
 * TB-01 report for why this is not valibot.
 *
 * Every object is closed (`additionalProperties: false`), except the two
 * maps whose values are plain numbers or axis definitions with closed
 * shapes. So there is no place in a stored or exported profile where a fact,
 * a confirmation, an override, an acknowledgement or a pending restore could
 * ride along: a profile carrying one is refused, never silently kept. The
 * schema test walks this schema and fails if any such property name appears.
 *
 * `PROFILE_V1_SCHEMA` reads the earlier v1 file format (OLD TOOLS_PLAN §5.1)
 * for migration only. v1 carried `facts` and `overrides`; the migration drops
 * them and reports the fact keys as needs re-verify (T-S22).
 */
import { CEILING_SECONDS } from '@synthetos/safety';
import { deepFreeze } from '../frozen.ts';
import type { Schema } from '../jsonSchema.ts';
import type { DialectId } from '@synthetos/protocol';

/** Every dialect a profile may name (RUN_PLAN §5.5 `DialectId`). */
export const PROFILE_DIALECT_IDS = Object.freeze([
  'tinyg-en',
  'tinyg-440',
  'tinyg-449-stock',
  'g2core-101.03',
  'g2core-edge',
] as const satisfies readonly DialectId[]);

/** Hold timeout bounds in seconds (SAFETY §4.4 rule 8: 15 to 600, default 60). */
export const HOLD_TIMEOUT_S = Object.freeze({ default: 60, min: 15, max: 600 });

/** Motor numbers a profile may name: TinyG has 4, g2core boards up to 6 (checked per family). */
export const MAX_MOTOR = 6;

const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const SHA256 = '^[0-9a-f]{64}$';
/** No C0 or C1 control characters, no bidi overrides or isolates (rendered with textContent in `<bdi>` too). */
const PLAIN_TEXT = '^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]*$';
const ID_TOKEN = '^[a-z0-9][a-z0-9._-]{0,63}$';
/** A settings key: lower-case letters and digits (`1ma`, `xvm`, `spep`, g2 `di1po`). */
const SETTING_KEY = '^[a-z0-9]{1,12}$';
/** `<dialect>@<commit>`, as `SettingsSchema.schemaKey` builds it. */
const SCHEMA_KEY = '^[a-z0-9][a-z0-9.-]{0,31}@[0-9a-f]{7,40}$';

const text = (maxLength: number): Schema => ({ type: 'string', minLength: 1, maxLength, pattern: PLAIN_TEXT });
const positive: Schema = { type: 'number', exclusiveMinimum: 0 };

const DIALECT: Schema = { enum: [...PROFILE_DIALECT_IDS] };

/** MachineProfile v2, as stored in IndexedDB and written to a `.synthetos.json` export. */
export const PROFILE_V2_SCHEMA: Schema = deepFreeze({
  $id: 'https://run.synthetos.com/schemas/machine-profile-v2.json',
  title: 'MachineProfile v2',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'name', 'boundDevice', 'board', 'firmware', 'machine', 'settings', 'wiringRef', 'createdWith'],
  properties: {
    schemaVersion: { const: 2 },
    id: { type: 'string', pattern: UUID },
    name: text(120),
    boundDevice: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['family', 'id', 'fb', 'dialectId'],
      properties: {
        family: { enum: ['tinyg', 'g2core'] },
        id: text(64),
        fb: positive,
        fbs: text(64),
        dialectId: DIALECT,
      },
    },
    board: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['id', 'rev', 'hv'],
      properties: {
        id: { type: 'string', pattern: ID_TOKEN },
        rev: { type: ['string', 'null'], minLength: 1, maxLength: 32, pattern: PLAIN_TEXT },
        hv: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
      },
    },
    firmware: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['dialectId', 'fb'],
      properties: {
        dialectId: DIALECT,
        fb: positive,
        fbs: text(64),
        imageSha256: { type: 'string', pattern: SHA256 },
      },
    },
    machine: { $ref: '#/$defs/machine' },
    settings: {
      type: 'object',
      additionalProperties: false,
      required: ['draft', 'schemaKey', 'deviceHash'],
      properties: {
        draft: {
          type: 'object',
          maxProperties: 2000,
          propertyNames: { type: 'string', pattern: SETTING_KEY },
          additionalProperties: { type: 'number' },
        },
        schemaKey: { type: ['string', 'null'], pattern: SCHEMA_KEY },
        deviceHash: { type: ['string', 'null'], pattern: SHA256 },
      },
    },
    wiringRef: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['id', 'sha256'],
      properties: { id: { type: 'string', pattern: ID_TOKEN }, sha256: { type: 'string', pattern: SHA256 } },
    },
    createdWith: {
      type: 'object',
      additionalProperties: false,
      required: ['tool', 'version', 'sha'],
      properties: {
        tool: text(64),
        version: text(32),
        sha: { type: ['string', 'null'], pattern: '^[0-9a-f]{7,40}$' },
      },
    },
  },
  $defs: {
    machine: {
      type: 'object',
      additionalProperties: false,
      required: [
        'type',
        'axes',
        'homingOrder',
        'spindle',
        'psu',
        'estop',
        'hostLossPolicy',
        'queuedMotionCeilingS',
        'jogCaps',
        'holdTimeoutS',
      ],
      properties: {
        type: { enum: ['router', 'laser', 'plasma', 'custom'] },
        axes: {
          type: 'object',
          additionalProperties: false,
          properties: {
            x: { $ref: '#/$defs/axis' },
            y: { $ref: '#/$defs/axis' },
            z: { $ref: '#/$defs/axis' },
            a: { $ref: '#/$defs/axis' },
            b: { $ref: '#/$defs/axis' },
            c: { $ref: '#/$defs/axis' },
          },
        },
        homingOrder: { type: 'array', uniqueItems: true, maxItems: 6, items: { enum: ['x', 'y', 'z', 'a', 'b', 'c'] } },
        spindle: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'drive', 'activeLow'],
          properties: {
            kind: { enum: ['spindle', 'laser', 'plasma', 'none'] },
            drive: { enum: ['none', 'relay', 'ssr', 'vfd-0-10v', 'pwm'] },
            activeLow: { type: 'boolean' },
          },
        },
        psu: {
          type: ['object', 'null'],
          additionalProperties: false,
          required: ['volts', 'amps', 'earthed'],
          properties: {
            volts: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
            amps: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
            earthed: { type: 'boolean' },
          },
        },
        estop: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'auxInput'],
          properties: { kind: text(80), auxInput: { type: ['string', 'null'], minLength: 1, maxLength: 32, pattern: PLAIN_TEXT } },
        },
        hostLossPolicy: { enum: ['drain', 'hold-and-spindle-pause'] },
        queuedMotionCeilingS: { type: 'number', minimum: CEILING_SECONDS.min, maximum: CEILING_SECONDS.max },
        jogCaps: {
          type: 'object',
          additionalProperties: false,
          required: ['maxStepMm', 'maxFeedMmPerMin'],
          properties: {
            maxStepMm: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
            maxFeedMmPerMin: { type: 'number', exclusiveMinimum: 0, maximum: 200_000 },
          },
        },
        holdTimeoutS: { type: ['number', 'null'], minimum: HOLD_TIMEOUT_S.min, maximum: HOLD_TIMEOUT_S.max },
      },
    },
    axis: {
      type: 'object',
      additionalProperties: false,
      required: ['motors', 'drive', 'measuredTravelMm', 'homeEnd'],
      properties: {
        motors: { type: 'array', minItems: 1, maxItems: MAX_MOTOR, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: MAX_MOTOR } },
        drive: {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: {
            kind: { enum: ['screw', 'belt', 'rack', 'rotary', 'unknown'] },
            pitchMm: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
            starts: { type: 'integer', minimum: 1, maximum: 16 },
            teeth: { type: 'integer', minimum: 1, maximum: 1000 },
            ratio: { type: 'number', exclusiveMinimum: 0, maximum: 10_000 },
          },
        },
        measuredTravelMm: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 100_000 },
        homeEnd: { enum: ['min', 'max', 'none'] },
      },
    },
  },
});

/**
 * The v1 file format (OLD TOOLS_PLAN §5.1), read for migration only. Its
 * `facts`, `overrides` and `confirmations` are accepted here so that an old
 * file can be read at all; the migration never copies them (T-S22).
 */
export const PROFILE_V1_SCHEMA: Schema = deepFreeze({
  title: 'MachineProfile v1 (read for migration only)',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'name', 'machine'],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: 'string', pattern: UUID },
    name: text(120),
    boundDevice: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['family', 'id', 'fb'],
      properties: { family: { enum: ['tinyg', 'g2core'] }, id: text(64), fb: positive },
    },
    board: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', pattern: ID_TOKEN },
        rev: { type: ['string', 'null'], minLength: 1, maxLength: 32, pattern: PLAIN_TEXT },
        hv: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
      },
    },
    firmware: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['dialectId', 'fb'],
      properties: { dialectId: DIALECT, fv: positive, fb: positive, imageSha256: { type: 'string', pattern: SHA256 } },
    },
    machine: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'axes', 'spindle'],
      properties: {
        type: { enum: ['router', 'laser', 'plasma', 'custom'] },
        axes: {
          type: 'object',
          additionalProperties: false,
          properties: {
            x: { $ref: '#/$defs/axis' },
            y: { $ref: '#/$defs/axis' },
            z: { $ref: '#/$defs/axis' },
            a: { $ref: '#/$defs/axis' },
            b: { $ref: '#/$defs/axis' },
            c: { $ref: '#/$defs/axis' },
          },
        },
        spindle: {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { enum: ['none', 'relay', 'ssr', 'vfd-0-10v', 'pwm'] }, activeLow: { type: 'boolean' } },
        },
        psu: {
          type: ['object', 'null'],
          additionalProperties: false,
          required: ['volts', 'amps', 'earthed'],
          properties: {
            volts: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
            amps: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
            earthed: { type: 'boolean' },
          },
        },
        estop: {
          type: ['object', 'null'],
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: text(80), auxInput: { type: ['string', 'null'], minLength: 1, maxLength: 32, pattern: PLAIN_TEXT } },
        },
        hostLossPolicy: { enum: ['drain', 'hold-and-spindle-pause'] },
      },
    },
    settings: {
      type: 'object',
      additionalProperties: false,
      properties: {
        device: { type: 'object' },
        draft: {
          type: 'object',
          maxProperties: 2000,
          propertyNames: { type: 'string', pattern: SETTING_KEY },
          additionalProperties: { type: 'number' },
        },
        schemaKey: { type: ['string', 'null'], maxLength: 80 },
        deviceHash: { type: ['string', 'null'], maxLength: 128 },
      },
    },
    wiring: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: { parts: { type: 'array' }, wires: { type: 'array' }, hash: { type: 'string', maxLength: 128 } },
    },
    facts: {
      type: 'array',
      maxItems: 1000,
      items: { type: 'object', required: ['key'], properties: { key: { type: 'string', minLength: 1, maxLength: 200 } } },
    },
    overrides: { type: 'array', maxItems: 1000, items: { type: 'object' } },
    confirmations: { type: 'array', maxItems: 1000, items: { type: 'object' } },
    createdWith: {
      type: 'object',
      additionalProperties: false,
      properties: { tool: text(64), version: text(32), sha: { type: ['string', 'null'], maxLength: 40 } },
    },
  },
  $defs: {
    axis: {
      type: 'object',
      additionalProperties: false,
      required: ['motors'],
      properties: {
        motors: { type: 'array', minItems: 1, maxItems: MAX_MOTOR, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: MAX_MOTOR } },
        drive: {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: {
            kind: { enum: ['screw', 'belt', 'rack', 'rotary', 'unknown'] },
            pitch: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
            starts: { type: 'integer', minimum: 1, maximum: 16 },
            teeth: { type: 'integer', minimum: 1, maximum: 1000 },
            ratio: { type: 'number', exclusiveMinimum: 0, maximum: 10_000 },
          },
        },
        travelMm: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 100_000 },
        homeEnd: { enum: ['min', 'max', 'none'] },
      },
    },
  },
});
