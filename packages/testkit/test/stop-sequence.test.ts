/**
 * The dialects' Stop job sequences (SAFETY §4.4), run step by step against
 * the firmware models (P0 review). The interpreter below is test code: the
 * machine's own executor arrives in Phase 1. It decodes every line the board
 * prints with the real classifier and the dialect's footer rule, so a
 * sequence that only works by ignoring a Garbled line fails here.
 */
import { checkFooterForDialect, classifyLine, mapStat, TINYG_440, TINYG_EN } from '@synthetos/protocol';
import type { ClassifiedLine, Dialect, StopStep } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import type { Sim } from '../src/simHost.ts';
import type { TinyG440Model } from '../src/firmware/tg440.ts';
import type { TinyGEdgeNextModel } from '../src/firmware/edgeNext.ts';
import { enSim, tgSim } from './helpers.ts';

type AnySim = Sim<TinyGEdgeNextModel | TinyG440Model>;

interface Outcome {
  readonly end: 'done' | 'halted' | 'timeout';
  readonly failedStep?: StopStep['kind'];
  readonly events: readonly ClassifiedLine[];
  readonly wrote: readonly string[];
}

const POLL_MS = 50;

function runStop(sim: AnySim, dialect: Dialect): Outcome {
  const events: ClassifiedLine[] = [];
  const wrote: string[] = [];
  let lastStat: number | null = null;
  const pump = (): ClassifiedLine[] => {
    const fresh = sim.host.take().map((l) => checkFooterForDialect(dialect, classifyLine(l)));
    for (const e of fresh) {
      events.push(e);
      if (e.kind === 'StatusReport' && typeof e.sr['stat'] === 'number') lastStat = e.sr['stat'];
      if (e.kind === 'Response' && typeof e.r['stat'] === 'number') lastStat = e.r['stat'];
    }
    return fresh;
  };
  const send = (line: string): void => {
    wrote.push(line);
    sim.host.sendLine(line);
  };
  /** One GET; returns the value from its Response. */
  const get = (key: string): unknown => {
    send(`{"${key}":null}`);
    for (let t = 0; t < 1000; t += 10) {
      sim.clock.advance(10);
      const r = pump().find((e) => e.kind === 'Response' && key in e.r);
      if (r !== undefined && r.kind === 'Response') return r.r[key];
    }
    return undefined;
  };
  /** Waits until `ok` (checked after each poll) or the timeout. */
  const until = (timeoutMs: number, ok: () => boolean): boolean => {
    for (let t = 0; t <= timeoutMs; t += POLL_MS) {
      if (ok()) return true;
      sim.clock.advance(POLL_MS);
      pump();
    }
    return ok();
  };

  pump();
  get('stat');
  for (const step of dialect.stopJob.steps) {
    switch (step.kind) {
      case 'awaitInFlightWrite':
      case 'stopFeeding':
      case 'confirm':
      case 'requireRehomeIfUnhomed':
      case 'resetCounters':
        break;
      case 'haltIfStat':
        if (lastStat !== null && step.stat.includes(lastStat)) return { end: 'halted', events, wrote };
        break;
      case 'writeRealtime':
        wrote.push(String.fromCharCode(step.byte));
        sim.host.send(String.fromCharCode(step.byte));
        sim.clock.advance(5);
        pump();
        break;
      case 'awaitHeld': {
        const moving = lastStat !== null && mapStat(dialect, lastStat) === 'running';
        if (!moving && step.skipIfNotMoving) break;
        const ok = until(step.timeoutMs, () => {
          const s = get('stat');
          return typeof s === 'number' && mapStat(dialect, s) === 'held';
        });
        if (!ok) return { end: 'timeout', failedStep: step.kind, events, wrote };
        break;
      }
      case 'awaitAlarm': {
        const before = lastStat;
        const ok =
          (before !== null && step.alreadyAlarmedStat.includes(before)) ||
          until(step.timeoutMs, () => events.some((e) => e.kind === 'Exception' && e.st === step.status));
        if (!ok) return { end: 'timeout', failedStep: step.kind, events, wrote };
        break;
      }
      case 'clearAlarm':
        get('clear');
        break;
      case 'writeLine': {
        const n = events.filter((e) => e.kind === 'Response').length;
        send(step.line);
        if (!until(1000, () => events.filter((e) => e.kind === 'Response').length > n)) {
          return { end: 'timeout', failedStep: step.kind, events, wrote };
        }
        break;
      }
      case 'verifyDrained': {
        let streak = 0;
        const ok = until(step.timeoutMs, () => {
          const stat = get('stat');
          const hold = step.holdZero ? get('hold') : 0;
          const vel = step.velZero ? get('vel') : 0;
          const good = typeof stat === 'number' && step.stat.includes(stat) && hold === 0 && vel === 0;
          streak = good ? streak + 1 : 0;
          return streak >= step.consecutive;
        });
        if (!ok) return { end: 'timeout', failedStep: step.kind, events, wrote };
        break;
      }
      case 'adviseEstop':
        break;
      case 'done':
        return { end: 'done', events, wrote };
    }
  }
  return { end: 'timeout', events, wrote };
}

const garbled = (o: Outcome): ClassifiedLine[] => o.events.filter((e) => e.kind === 'Garbled');

describe('Stop job sequences against the models (SAFETY §4.4)', () => {
  it('[TG-FLUSH-REPORTS] TG: ! → % → drain → M5 → M9 completes, and the unsolicited {"rx":n} is an RxReport, not Garbled', () => {
    const sim = tgSim();
    sim.host.sendLine('M3');
    sim.host.sendLine('G1 X100 F600');
    sim.clock.advance(400);
    const out = runStop(sim, TINYG_440);
    expect(out.end).toBe('done');
    expect(garbled(out)).toEqual([]);
    expect(out.events.some((e) => e.kind === 'RxReport')).toBe(true);
    expect(sim.device.snapshot().spindle).toBe('off');
  });

  it('[EN-LIMIT] EN: a board already in ALARM 203 stops through the existing alarm (no 207 ever comes), then C13 and clear', () => {
    const sim = enSim({}, { faults: { faults: [{ kind: 'alarm', atMs: 300, cause: 'limitSwitch' }] } });
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(600);
    expect(sim.device.snapshot().stat).toBe(2);
    const out = runStop(sim, TINYG_EN);
    expect(out.end).toBe('done');
    expect(out.events.some((e) => e.kind === 'Exception' && e.st === 207)).toBe(false);
    expect(garbled(out)).toEqual([]);
    expect(sim.device.snapshot().stat).not.toBe(2);
  });

  it('[EN-LIMIT] EN: without the already-alarmed rule the same board would time out (the rule is load-bearing)', () => {
    const sim = enSim({}, { faults: { faults: [{ kind: 'alarm', atMs: 300, cause: 'limitSwitch' }] } });
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(600);
    const strict: Dialect = {
      ...TINYG_EN,
      stopJob: {
        ...TINYG_EN.stopJob,
        steps: TINYG_EN.stopJob.steps.map((s) => (s.kind === 'awaitAlarm' ? { ...s, alreadyAlarmedStat: [] } : s)),
      },
    };
    expect(runStop(sim, strict)).toMatchObject({ end: 'timeout', failedStep: 'awaitAlarm' });
  });

  it('[EN-SHUTDOWN] EN: a board in SHUTDOWN halts before ^D (E-stop advice and the reset path)', () => {
    const sim = enSim();
    sim.host.sendLine('{"shutd":null}');
    sim.clock.advance(50);
    sim.host.take();
    const out = runStop(sim, TINYG_EN);
    expect(out.end).toBe('halted');
    expect(out.wrote).not.toContain('\x04');
  });

  it('[EN-ALARM] EN: a moving board stops with ^D and er 207 as before', () => {
    const sim = enSim();
    sim.host.sendLine('M3');
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(400);
    const out = runStop(sim, TINYG_EN);
    expect(out.end).toBe('done');
    expect(out.events.some((e) => e.kind === 'Exception' && e.st === 207)).toBe(true);
    expect(garbled(out)).toEqual([]);
    expect(sim.device.snapshot().spindle).toBe('off');
  });
});
