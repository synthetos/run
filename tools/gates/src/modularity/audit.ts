import { ESLint } from 'eslint';
import { relative } from 'node:path';
import type { BaselineFile } from './types.ts';
/** Whole-scope check also catches baseline entries for removed/ignored files. */
export async function auditModularity(root: string, baseline: BaselineFile): Promise<string[]> {
  const results = await new ESLint({ cwd: root }).lintFiles(['apps', 'packages', 'tools', 'workers']);
  const present = new Set(results.map(result => relative(root, result.filePath).replaceAll('\\', '/')));
  const errors = results.flatMap(result => result.messages.filter(message => message.fatal || message.message.startsWith('Modularity')).map(message => `${relative(root, result.filePath)}:${message.line}: ${message.message}`));
  for (const file of Object.keys(baseline.files)) if (!present.has(file)) errors.push(`Remove baseline for absent/ignored file: ${file}`);
  return errors;
}
