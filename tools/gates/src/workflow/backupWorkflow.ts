// Owner backup decision, 2026-11-13: exact protected main-branch backup and manual restore jobs.
import { createHash } from 'node:crypto';
const reviewed: Record<string, string> = {
  "database-restore.yml": "fd4bca47bccf093d443bbcffcfbac828ce45d4a94ec9e17b858a97875a89e4e7"
};
export function reviewedBackupWorkflow(name: string, source: string): boolean {
  return createHash('sha256').update(source).digest('hex') === reviewed[name];
}
