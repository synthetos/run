/**
 * Schemas for engine output (MACHINING_ASSISTANT §1 principle 2, §5.3: "every
 * engine returns structured data validated against a schema"). Checked with
 * the repository's own validator. Its `number` type admits finite numbers
 * only, so NaN and Infinity never pass; every speed and feed is positive.
 * Closed objects: an engine cannot add a field the guard does not read.
 */
import type { Schema } from '@synthetos/schema/json-schema';
import { PLAIN_TEXT, deepFreeze } from '@synthetos/library';

const text = (maxLength: number): Schema => ({ type: 'string', minLength: 1, maxLength, pattern: PLAIN_TEXT });
const positive = (maximum: number): Schema => ({ type: 'number', exclusiveMinimum: 0, maximum });

export const RECOMMENDATION_SCHEMA: Schema = deepFreeze({
  title: 'Recommendation',
  type: 'object',
  additionalProperties: false,
  required: ['level', 'rpm', 'feed', 'reasons', 'preview', 'placeholder', 'engine'],
  properties: {
    level: { enum: ['conservative', 'balanced', 'aggressive'] },
    rpm: positive(1_000_000),
    feed: positive(1_000_000),
    reasons: { type: 'array', maxItems: 20, items: text(500) },
    preview: { type: 'boolean' },
    placeholder: { type: 'boolean' },
    engine: text(64),
    dialSetting: text(16),
  },
});

export const SUGGESTION_SCHEMA: Schema = deepFreeze({
  title: 'Suggestion',
  type: 'object',
  additionalProperties: false,
  required: ['reason', 'preview', 'engine'],
  properties: {
    scale: positive(100),
    feed: positive(1_000_000),
    rpm: positive(1_000_000),
    reason: text(500),
    preview: { type: 'boolean' },
    engine: text(64),
  },
});

export const REVIEW_SCHEMA: Schema = deepFreeze({
  title: 'Review',
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings', 'preview', 'engine'],
  properties: {
    summary: text(2000),
    findings: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['level', 'text'],
        properties: { level: { enum: ['info', 'warn'] }, text: text(500) },
      },
    },
    preview: { type: 'boolean' },
    engine: text(64),
  },
});

/** At most this many items are read from one engine call. */
export const MAX_ENGINE_ITEMS = 30;
