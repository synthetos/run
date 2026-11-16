/** Strict plain-object RPC key inventory. */
export function plainKeys(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  return Object.keys(value).sort().join(',');
}
