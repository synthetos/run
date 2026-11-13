/** Display/input conversions only. Stored cutting data remains vc and fz in metric units. */
import type { Tool } from '@synthetos/library';
export function canConvertSpeed(tool: Tool): boolean {
  return Number.isFinite(tool.geometry.diameter) && tool.geometry.diameter > 0 && Number.isInteger(tool.geometry.flutes) && tool.geometry.flutes > 0;
}
export function fromRpmFeed(tool: Tool, rpm: number, feed: number): { vc: number; fz: number } | null {
  if (!canConvertSpeed(tool) || !Number.isInteger(rpm) || rpm <= 0 || !Number.isFinite(feed) || feed <= 0) return null;
  const vc = Math.PI * tool.geometry.diameter * rpm / 1000;
  const fz = feed / (rpm * tool.geometry.flutes);
  return Number.isFinite(vc) && vc > 0 && Number.isFinite(fz) && fz > 0 ? { vc, fz } : null;
}
export function toRpmFeed(tool: Tool, vc: number | undefined, fz: number): { rpm: number; feed: number } | null {
  if (!canConvertSpeed(tool) || vc === undefined || !Number.isFinite(vc) || vc <= 0 || !Number.isFinite(fz) || fz <= 0) return null;
  const rpm = vc * 1000 / (Math.PI * tool.geometry.diameter);
  const feed = fz * rpm * tool.geometry.flutes;
  return Number.isFinite(rpm) && Number.isFinite(feed) ? { rpm, feed } : null;
}
