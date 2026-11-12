export type ToolUnit = 'mm' | 'in';
export const MM_PER_INCH = 25.4;
export function formatLength(mm: number, unit: ToolUnit): string {
  return String(Number((unit === 'mm' ? mm : mm / MM_PER_INCH).toFixed(unit === 'mm' ? 3 : 4)));
}
/** Strict positive decimal, or (in inches) fraction and mixed fraction. Never accepts trailing junk. */
export function parseLength(raw: string, unit: ToolUnit): number | null {
  const s = raw.trim();
  let n: number;
  if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) n = Number(s);
  else {
    const m = unit === 'in' ? /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(s) : null;
    if (m === null || Number(m[3]) === 0) return null;
    n = Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]);
  }
  const mm = unit === 'in' ? n * MM_PER_INCH : n;
  return Number.isFinite(mm) && mm >= 0 ? mm : null;
}
