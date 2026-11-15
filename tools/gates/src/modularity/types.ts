/** Reviewed per-symbol debt. Limits live in eslint.config.js, never in this file. */
export interface BaselineFile { readonly format: 1; readonly files: Readonly<Record<string, Readonly<Record<string, number>>>> }
export interface Measurement { readonly metric: string; readonly symbol: string; readonly actual: number }
export const BASELINE_PATH = 'tools/gates/modularity-baseline.json';
export const CORE_METRICS = {
  'max-lines': 'actual',
  'max-lines-per-function': 'lineCount',
  complexity: 'complexity',
  'max-depth': 'depth',
  'max-params': 'count',
  'max-nested-callbacks': 'num',
  'max-classes-per-file': 'classCount',
} as const;
export const METRICS = [...Object.keys(CORE_METRICS), 'max-methods', 'max-switch-cases'];
export function measurementKey(m: Pick<Measurement, 'metric' | 'symbol'>): string { return `${m.metric} ${m.symbol}`; }
function baselineShape(value: unknown): asserts value is BaselineFile {
  if (!value || typeof value !== 'object' || !('format' in value) || value.format !== 1 || !('files' in value) || !value.files || typeof value.files !== 'object' || Array.isArray(value.files)) throw new Error('Invalid modularity baseline');
}
function validateEntries(file: string, entries: unknown): void {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length === 0) throw new Error(`Empty or invalid baseline entries: ${file}`);
  for (const [key, number] of Object.entries(entries)) {
    if (!METRICS.some(metric => key.startsWith(`${metric} `)) || typeof number !== 'number' || !Number.isInteger(number) || number < 1) throw new Error(`Invalid baseline measurement: ${file} ${key}`);
  }
}
export function readBaseline(value: unknown): BaselineFile {
  baselineShape(value);
  for (const [file, entries] of Object.entries(value.files)) {
    if (!/^(apps|packages|tools|workers)\//.test(file) || file.includes('..') || file.includes('\\')) throw new Error(`Invalid baseline path: ${file}`);
    validateEntries(file, entries);
  }
  return value;
}
