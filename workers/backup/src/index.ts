import type { Bucket, Database } from './types.ts';
import { backupScheduled } from './scheduled.ts';
import { filesScheduled } from './files-scheduled.ts';
import type { FileBackup, FileSource } from './files-types.ts';
import { SOURCES } from './sources.ts';
interface Env { [binding: string]: unknown; SCRATCH: Database; BACKUPS: Bucket & FileBackup; SOURCE_FILES?: FileSource; BACKUP_ENV: 'production' | 'staging' }
export default {
  fetch(): Response { return new Response(null, { status: 404 }); },
  async scheduled(event: { scheduledTime: number }, env: Env): Promise<void> {
    const sources = SOURCES.filter(source => !source.optional || env[source.binding] !== undefined).map(source => ({ name: source.database + (env.BACKUP_ENV === 'staging' ? '-staging' : ''), database: env[source.binding] as Database }));
    const date = new Date(event.scheduledTime), log = (record: Record<string, unknown>): void => console.log(JSON.stringify(record));
    try { await backupScheduled('run', env.BACKUP_ENV, sources, env.SCRATCH, env.BACKUPS, date, log); }
    finally { await filesScheduled({ source: env.SOURCE_FILES, backup: env.BACKUPS, environment: env.BACKUP_ENV, date, log }); }
  },
};
