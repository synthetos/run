// Owner backup decision, 2026-11-13: exact protected main-branch backup and manual restore jobs.
import { createHash } from 'node:crypto';
const reviewed: Record<string, string> = {
  "database-backups.yml": "c4e9b976bb1decef60f43d77bd6273174ede329fed5d0819fee9db32881ac1bd",
  "database-restore.yml": "e05e86a0417c6b0a8c870e21c2f51682947029fe794b83bb3351dd9fda17bf87"
};
export function reviewedBackupWorkflow(name: string, source: string): boolean {
  return createHash('sha256').update(source).digest('hex') === reviewed[name];
}
