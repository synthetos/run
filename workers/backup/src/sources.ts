// Provisioning and cron share the reviewed sources. Missing optional data leaves existing auth backups running.
export const SOURCES = [{ binding: 'SOURCE', database: 'run-auth', optional: false }, { binding: 'SOURCE_DATA', database: 'run-data', optional: true }] as const;
