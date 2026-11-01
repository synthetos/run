/**
 * The worker side of the preview, separated from `self` so it runs under test:
 * one load at a time; findings are answered from the last load's index, so
 * the page never receives (or clones) every finding of a large file.
 */
import type { FindingIndex } from '@synthetos/gcode';
import { analyseBytes, readBlob, transferablesOf } from './pipeline.ts';
import type { FromGcodeWorker, ToGcodeWorker } from './protocol.ts';

/** Most findings returned for one range request (the rows in view). */
export const MAX_FINDINGS_PER_REQUEST = 2000;

export type Post = (message: FromGcodeWorker, transfer?: Transferable[]) => void;

export function createGcodeHandler(post: Post): (message: ToGcodeWorker) => Promise<void> {
  let index: FindingIndex | null = null;
  return async (message) => {
    if (message.type === 'findings') {
      post({ type: 'findings', id: message.id, findings: index === null ? [] : index.between(message.from, message.to).slice(0, MAX_FINDINGS_PER_REQUEST) });
      return;
    }
    index = null;
    try {
      const progress = (p: Parameters<NonNullable<Parameters<typeof analyseBytes>[2]>>[0]): void => { post({ type: 'progress', id: message.id, progress: p }); };
      const bytes = await readBlob(message.blob, progress);
      const { result, findings } = analyseBytes(bytes, message.request, progress);
      index = findings;
      post({ type: 'result', id: message.id, result }, transferablesOf(result));
    } catch (e) {
      post({ type: 'error', id: message.id, message: e instanceof Error ? e.message : String(e) });
    }
  };
}
