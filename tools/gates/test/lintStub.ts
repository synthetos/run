/** A replacement stub has none of the real file's legacy size/complexity debt.
 * Remove only that file's allowances in the throwaway copy. All rules remain on;
 * ordinary ScratchRepo.write and the real repository's baseline are unchanged.
 */
import { BASELINE_PATH, readBaseline } from '../src/modularity/types.ts';
import type { ScratchRepo } from './scratch.ts';
export function writeLintStub(repo: Pick<ScratchRepo, 'read' | 'write'>, path: string, code: string): void {
  const baseline = readBaseline(JSON.parse(repo.read(BASELINE_PATH)));
  const files = { ...baseline.files };
  delete files[path];
  repo.write(BASELINE_PATH, `${JSON.stringify({ ...baseline, files }, null, 2)}\n`);
  repo.write(path, code);
}
