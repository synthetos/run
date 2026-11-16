import { PROBE_STEPS, type ApprovedBuilds } from '@synthetos/protocol';
import { isReadAllowed } from '@synthetos/schema';
import { READING_TOKENS, SEED_TOKENS, type SessionEffect } from '../src/index.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';

export const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

export const PROBE_LINES = PROBE_STEPS.map((s) => s.line);

export const READING_LINES = READING_TOKENS.map((t) => `{"${t}":null}`);

export const seedLines = (dialect: string): string[] => SEED_TOKENS.filter((t) => isReadAllowed(dialect, t)).map((t) => `{"${t}":null}`);

export const EN_CONNECT = [...PROBE_LINES, ...READING_LINES, ...seedLines('tinyg-en')];

export const seedValues = (d: Driver): Record<string, unknown> => Object.fromEntries(Object.entries(d.state.values).filter(([k]) => !SEED_TOKENS.includes(k)));

export function connected(answers = EN_ANSWERS, options: ConstructorParameters<typeof Driver>[0] = {}, expected: string | null = null): Driver {
  const d = new Driver(options);
  d.open(expected);
  d.answer(answers);
  return d;
}

export const realtime = (effects: readonly SessionEffect[]): number[] =>
  effects.filter((e) => e.kind === 'writeRealtime').map((e) => (e as Extract<SessionEffect, { kind: 'writeRealtime'; }>).byte);
