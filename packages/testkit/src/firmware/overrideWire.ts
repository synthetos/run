/** @behaviour EN-45005 @behaviour EN-45006-OVERRIDES */
import '../marker.ts';
import { ModelGapError } from './common.ts';
import type { LiveOverrides } from './liveOverrides.ts';
import type { GcodeInput } from './gcodeInput.ts';
import type { HostValue } from './hostJson.ts';
import type { OutValue } from './output.ts';
interface Context {
  build(): number; spindleOn(): boolean; capped(): boolean; alarm(): number;
  queue(label: string, fn: () => void): void;
}
const REMOVED = ['spph', 'spde', 'coph'];
const FEED = ['mfo', 'mfoe', 'm48e', 'mfc', 'mcp', 'mfe'];
export class OverrideWire {
  private readonly state: LiveOverrides;
  private readonly context: Context;
  constructor(state: LiveOverrides, context: Context) { this.state = state; this.context = context; }
  get(key: string, body: Record<string, OutValue>): number | undefined {
    const fb = this.context.build();
    if (fb < 450.05) return undefined;
    if (REMOVED.includes(key)) return 100;
    if (fb < 450.06) {
      if (!FEED.includes(key)) return undefined;
      body[key] = key === 'mcp' ? 0 : 1; return 0;
    }
    const value = this.state.read(key, this.context.spindleOn(), this.context.capped());
    if (value === undefined) return undefined;
    body[key] = value; return 0;
  }
  set(key: string, value: HostValue, body: Record<string, OutValue>): number | undefined {
    const fb = this.context.build();
    if (fb < 450.05) return undefined;
    if (REMOVED.includes(key)) return 100;
    if (fb < 450.06) {
      if (FEED.includes(key)) throw new ModelGapError('450.05 override writes are outside the Part A model');
      return undefined;
    }
    if (this.state.read(key, false, false) === undefined) return undefined;
    const alarm = this.context.alarm();
    const result = alarm || this.state.write(key, value);
    body[key] = typeof value === 'number' ? value : null;
    return result;
  }
  runtime(key: string, value: HostValue, body: Record<string, OutValue>): number | undefined {
    if (this.context.build() < 450.06 || (key !== 'mfo' && key !== 'sso')) return undefined;
    return value === null ? this.get(key, body) : this.set(key, value, body);
  }
  queue(g: GcodeInput): number {
    if (g.override === undefined) return 0;
    const code = g.override, p = g.p ?? 1;
    if ((code === 50 || code === 51) && p !== 0 && p !== 1) return 161;
    this.context.queue('override permission', () => this.state.program(code, p));
    return 0;
  }
}
export function heartbeatValue(value: HostValue, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}
