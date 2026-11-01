/** Shared test helpers for the firmware model tests. */
import { createSim, type Sim } from '../src/simHost.ts';
import { TinyGEdgeNextModel } from '../src/firmware/edgeNext.ts';
import { TinyG440Model } from '../src/firmware/tg440.ts';
import type { TinyGModelOptions } from '../src/firmware/common.ts';
import type { FaultPlan } from '../src/faults.ts';

export interface Reply {
  readonly r: Record<string, unknown>;
  readonly f: number[];
  readonly tid?: number;
  readonly line: string;
}

export function enSim(options: TinyGModelOptions = {}, sim: { faults?: FaultPlan; seed?: number } = {}): Sim<TinyGEdgeNextModel> {
  return createSim(new TinyGEdgeNextModel(options), sim);
}

export function tgSim(options: TinyGModelOptions = {}, sim: { faults?: FaultPlan; seed?: number } = {}): Sim<TinyG440Model> {
  return createSim(new TinyG440Model(options), sim);
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(line);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Every `{"r":...,"f":[...]}` line, in order. */
export function replies(lines: readonly string[]): Reply[] {
  const out: Reply[] = [];
  for (const line of lines) {
    const v = parse(line);
    if (v === undefined || !('r' in v) || !Array.isArray(v['f'])) continue;
    out.push({ r: v['r'] as Record<string, unknown>, f: v['f'] as number[], ...(typeof v['tid'] === 'number' ? { tid: v['tid'] } : {}), line });
  }
  return out;
}

/** Every `{"er":{...}}` body, in order. */
export function exceptions(lines: readonly string[]): { st: number; msg: string }[] {
  return lines.map(parse).flatMap((v) => (v !== undefined && typeof v['er'] === 'object' && v['er'] !== null ? [v['er'] as { st: number; msg: string }] : []));
}

/** Every `{"sr":{...}}` body, in order. */
export function reports(lines: readonly string[]): Record<string, unknown>[] {
  return lines.map(parse).flatMap((v) => (v !== undefined && typeof v['sr'] === 'object' && v['sr'] !== null ? [v['sr'] as Record<string, unknown>] : []));
}

/** Send a GET and return its value from the reply (advances the clock a little). */
export function get(sim: Sim<TinyGEdgeNextModel | TinyG440Model>, key: string): unknown {
  sim.host.take();
  sim.host.sendLine(`{"${key}":null}`);
  sim.clock.advance(30);
  const reply = replies(sim.host.take()).find((r) => key in r.r);
  return reply?.r[key];
}

/** Status of the last reply in `lines`. */
export function statuses(lines: readonly string[]): number[] {
  return replies(lines).map((r) => r.f[1] as number);
}
