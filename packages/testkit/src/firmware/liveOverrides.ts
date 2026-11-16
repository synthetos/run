/** @behaviour EN-45006-OVERRIDES: RAM requests, permissions and lifecycle.
 * Models wire state, not acceleration/jerk, pulse timing or PWM transitions (LIM-EN-OVERRIDE-TIMING).
 */
import '../marker.ts';
export class LiveOverrides {
  feed = 1;
  spindle = 1;
  master = 1;
  feedEnable = 1;
  spindleEnable = 1;
  feedProgram = 1;
  spindleProgram = 1;
  reset(): void {
    this.feed = this.spindle = this.master = this.feedEnable = this.spindleEnable = this.feedProgram = this.spindleProgram = 1;
  }
  read(key: string, spindleOn: boolean, capped: boolean): number | undefined {
    const feedAllowed = this.master * this.feedEnable * this.feedProgram;
    const spindleAllowed = this.master * this.spindleEnable * this.spindleProgram;
    const values: Record<string, number> = {
      mfo: this.feed, mfoe: this.feedEnable, m48e: this.master, mfc: feedAllowed ? this.feed : 1, mcp: 0, mfe: feedAllowed,
      sso: this.spindle, ssoe: this.spindleEnable, ssc: spindleOn && spindleAllowed ? this.spindle : 1, scp: Number(spindleOn && capped), sse: spindleAllowed,
    };
    return values[key];
  }
  write(key: string, value: unknown): number | undefined {
    if (['mfc', 'mcp', 'mfe', 'ssc', 'scp', 'sse'].includes(key)) return 104;
    if (!['mfo', 'sso', 'mfoe', 'ssoe', 'm48e'].includes(key)) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) return 110;
    if (key === 'mfo' || key === 'sso') {
      if (value < 0.05 || value > 2) return 110;
      if (key === 'mfo') this.feed = value; else this.spindle = value;
    } else {
      if (value !== 0 && value !== 1) return 110;
      if (key === 'mfoe') this.feedEnable = value;
      else if (key === 'ssoe') this.spindleEnable = value;
      else this.master = value;
    }
    return 0;
  }
  program(code: number, p = 1): void {
    if (code === 48 || code === 49) this.feedProgram = this.spindleProgram = code === 48 ? 1 : 0;
    if (code === 50) this.feedProgram = p;
    if (code === 51) this.spindleProgram = p;
  }
}

/** Test initial condition: an already-powered board, after an earlier program set permission. */
export function priorOverrideProgram(state: LiveOverrides, prior: { readonly feed: boolean; readonly spindle: boolean } | undefined): void {
  if (!prior) return;
  state.program(50, Number(prior.feed));
  state.program(51, Number(prior.spindle));
}

/** The speed cap is observational; PWM and motion timing remain outside this model. */
export function spindleCapped(state: LiveOverrides, speed: number, range: { readonly low: number; readonly high: number }): boolean {
  const applied = speed * (state.read('ssc', true, false) ?? 1);
  return applied < range.low || applied > range.high;
}
