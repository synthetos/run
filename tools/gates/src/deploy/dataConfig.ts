import type { DeployEnvironment } from './wranglerConfig.ts';

export const DATA_DATABASE_PLACEHOLDER = 'RUN_DATA_PRODUCTION_DATABASE_ID_PLACEHOLDER';
export const DATA_BUCKET_PLACEHOLDER = 'RUN_FILES_PRODUCTION_PLACEHOLDER';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const dataNames = (environment: DeployEnvironment) => {
  if (environment !== 'production' && environment !== 'staging') throw new Error('Invalid data environment');
  const suffix = environment === 'staging' ? '-staging' : '';
  return { database: `run-data${suffix}`, bucket: `run-files${suffix}` };
};
/** Positive allowlist: the data Worker has no host, extra bindings, build hook or public entry. */
export function dataDeployConfig(account: string, database: string, environment: DeployEnvironment = 'staging'): Record<string, unknown> {
  if (!/^[0-9a-f]{32}$/.test(account) || !UUID.test(database)) throw new Error('Invalid data deployment identifiers');
  const names = dataNames(environment);
  return { name: names.database, compatibility_date: '2026-10-01', account_id: account, workers_dev: false, preview_urls: false, routes: [], find_additional_modules: true, rules: [{ type: 'ESModule', globs: ['**/*.mjs'] }], d1_databases: [{ binding: 'RUN_DATA_DB', database_name: names.database, database_id: database, migrations_dir: 'migrations' }], r2_buckets: [{ binding: 'RUN_FILES', bucket_name: names.bucket }] };
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  return value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordered(v)])) : value;
}
/** A reviewed placeholder keeps storage off. Invalid or extra production settings refuse deployment. */
export function productionDataConfig(value: unknown, account: string): Record<string, unknown> | null {
  const config = value as Record<string, unknown> | null;
  if (config === null || typeof config !== 'object') throw new Error('Invalid reviewed data configuration');
  const { id, bucket } = resourceIds(config);
  const ready = id !== DATA_DATABASE_PLACEHOLDER && bucket !== DATA_BUCKET_PLACEHOLDER;
  const expected = dataDeployConfig(account, ready ? id as string : '00000000-0000-0000-0000-000000000000', 'production');
  const reviewed = { ...expected, main: 'src/index.ts', d1_databases: [{ binding: 'RUN_DATA_DB', database_name: 'run-data', database_id: id, migrations_dir: 'migrations' }], r2_buckets: [{ binding: 'RUN_FILES', bucket_name: bucket }] };
  const { env: _staging, ...scope } = config;
  if (JSON.stringify(ordered(scope)) !== JSON.stringify(ordered(reviewed))) throw new Error('Production data configuration differs from the reviewed allowlist');
  return ready ? expected : null;
}

function resourceIds(config: Record<string, unknown>): { id: unknown; bucket: unknown } {
  const id = (config['d1_databases'] as { database_id?: unknown }[] | undefined)?.[0]?.database_id;
  const bucket = (config['r2_buckets'] as { bucket_name?: unknown }[] | undefined)?.[0]?.bucket_name;
  if (id !== DATA_DATABASE_PLACEHOLDER && (typeof id !== 'string' || !UUID.test(id))) throw new Error('Invalid production data database id');
  if (bucket !== DATA_BUCKET_PLACEHOLDER && bucket !== 'run-files') throw new Error('Invalid production files bucket');
  return { id, bucket };
}
