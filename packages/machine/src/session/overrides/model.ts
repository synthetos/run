/** TinyG 450.06 live controls: requested values are never inferred from a click. */
import type { SessionState } from '../types.ts';
export type OverrideChannel = 'feed' | 'spindle';
export interface OverrideRequest { readonly channel: OverrideChannel; readonly percent: number }
export interface OverrideReading {
  readonly requested: number | null;
  readonly effective: number | null;
  readonly capped: boolean;
  readonly permitted: boolean | null;
}
export interface OverrideView {
  readonly feed: OverrideReading;
  readonly spindle: OverrideReading;
  readonly busy: boolean;
  readonly error: string | null;
}
export interface OverrideMemory {
  readonly epoch: number;
  readonly since: number;
  readonly nextRead: number;
  readonly pending: string | null;
  readonly error: string | null;
}
export type OverrideState = SessionState & { readonly overrides?: OverrideMemory | undefined };
export const OVERRIDE_TOKENS = ['mfo', 'mfc', 'mcp', 'mfe', 'sso', 'ssc', 'scp', 'sse'] as const;
export function supportsOverrides(s: Pick<SessionState, 'identity' | 'dialect'>): boolean {
  return s.dialect?.id === 'tinyg-en' && typeof s.identity?.fb === 'number' && s.identity.fb >= 450.06;
}
export function clampOverride(percent: number): number {
  return Math.max(10, Math.min(150, Math.round(percent / 10) * 10));
}
export function validOverride(value: unknown): value is OverrideRequest {
  if (value === null || typeof value !== 'object') return false;
  const r = value as Partial<OverrideRequest>;
  return (r.channel === 'feed' || r.channel === 'spindle') && typeof r.percent === 'number' &&
    Number.isFinite(r.percent) && r.percent >= 10 && r.percent <= 150 && r.percent % 10 === 0;
}
export function overrideLine(request: OverrideRequest): string {
  return JSON.stringify({ rt: { [request.channel === 'feed' ? 'mfo' : 'sso']: request.percent / 100 } });
}
export function parseOverrideLine(line: string): OverrideRequest | null {
  const m = /^\{"rt":\{"(mfo|sso)":(0\.[1-9]|1(?:\.[1-5])?)\}\}$/.exec(line);
  return m === null ? null : { channel: m[1] === 'mfo' ? 'feed' : 'spindle', percent: Math.round(Number(m[2]) * 100) };
}
function value(s: OverrideState, key: string): number | null {
  const entry = s.values[key];
  const now = s.live.lastRxAt ?? 0;
  if (!s.overrides || !entry || entry.status !== 0 || entry.at < s.overrides.since || now - entry.at > 2500) return null;
  if (typeof entry.value === 'boolean') return Number(entry.value);
  return typeof entry.value === 'number' && Number.isFinite(entry.value) ? entry.value : null;
}
function reading(s: OverrideState, keys: readonly string[]): OverrideReading {
  const [requested, effective, capped, permitted] = keys.map(key => value(s, key));
  return Object.freeze({ requested: requested == null ? null : Math.round(requested * 100), effective: effective == null ? null : Math.round(effective * 100), capped: capped === 1, permitted: permitted == null ? null : permitted === 1 });
}
export function overrideView(s: OverrideState): OverrideView | null {
  if (!supportsOverrides(s)) return null;
  return Object.freeze({
    feed: reading(s, OVERRIDE_TOKENS.slice(0, 4)),
    spindle: reading(s, OVERRIDE_TOKENS.slice(4)),
    busy: s.overrides?.pending != null,
    error: s.overrides?.error ?? null,
  });
}
