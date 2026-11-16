import { type ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_2_RELEASE } from '@synthetos/safety';
import {
  type SessionEffect,
  type SessionIntent
} from '../src/index.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';


export const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};


export const OK = '{"r":{},"f":[3,0,10]}';

export const BASE_ANSWERS: Record<string, string> = { ...EN_ANSWERS, gc: OK, clear: '{"r":{"clear":null},"f":[3,0,10]}', home: '{"r":{"home":0},"f":[3,0,10]}', unit: '{"r":{"unit":1},"f":[3,0,10]}' };


export function answers(patch: Record<string, string> = {}): Record<string, string> {
  return { ...BASE_ANSWERS, ...patch };
}


export const num = (token: string, v: number): string => `{"r":{"${token}":${v}},"f":[3,0,10]}`;


export function connected(patch: Record<string, string> = {}, options: { readonly release?: typeof PHASE_2_RELEASE; readonly unknown?: boolean } = {}): Driver {
  const d = new Driver({ release: options.release ?? PHASE_2_RELEASE, manifest: EN_APPROVED });
  if (options.unknown === true) d.state = { ...d.state, unknownOnNextConnect: true };
  d.open();
  d.answer(answers(patch));
  return d;
}


/** Answers the `unit` and `dist` reads a jog or go to zero sends before its first line (modes.ts). */
export function modes(d: Driver): void {
  d.answer(answers(), (t) => t !== 'unit' && t !== 'dist');
}


export function req(d: Driver, r: SessionIntent) {
  return d.intent(r);
}


export function motionLines(d: Driver, from = 0): string[] {
  return d.effects
    .slice(from)
    .filter((e): e is Extract<SessionEffect, { kind: 'writeLine' }> => e.kind === 'writeLine' && e.motion !== undefined)
    .map((e) => e.line);
}


export function realtimeNames(d: Driver, from = 0): string[] {
  return d.effects
    .slice(from)
    .filter((e): e is Extract<SessionEffect, { kind: 'writeRealtime' }> => e.kind === 'writeRealtime')
    .map((e) => e.name);
}
