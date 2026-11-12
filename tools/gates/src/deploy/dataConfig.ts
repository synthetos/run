/** Positive allowlist: the data Worker has no host, extra bindings, build hook or public entry. */
export function dataDeployConfig(account: string, database: string): Record<string, unknown> {
  if (!/^[0-9a-f]{32}$/.test(account) || !/^[0-9a-f-]{36}$/.test(database)) throw new Error('Invalid data deployment identifiers');
  return { name:'run-data-staging', compatibility_date:'2026-10-01', account_id:account, workers_dev:false, preview_urls:false, routes:[], find_additional_modules:true, rules:[{type:'ESModule',globs:['**/*.mjs']}], d1_databases:[{binding:'RUN_DATA_DB',database_name:'run-data-staging',database_id:database,migrations_dir:'migrations'}],r2_buckets:[{binding:'RUN_FILES',bucket_name:'run-files-staging'}] };
}
