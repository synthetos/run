/** Drawing detail only: never reads a file, interprets a line, or changes the complete segments used by Play/carving. */
import type { Box3, PreviewRenderer, SegmentList } from '@synthetos/gcode-view';

export const COARSE_SEGMENTS = 150_000;
export type DetailStage = 'coarse' | 'refining' | 'full';

/** First drawn vertex at/after each file-level tool change. Binary searches avoid a second scan of the program. */
export function toolVertices(list: SegmentList, changes: Uint32Array | undefined, source: Uint32Array | undefined): number[] {
  if (changes === undefined || source === undefined) return [];
  return Array.from(changes, (line) => {
    let lo = 0, hi = source.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((source[mid] as number) < line) lo = mid + 1; else hi = mid;
    }
    return list.lineToVertex[lo] ?? list.kinds.length;
  });
}

export interface DetailOptions {
  readonly signal: AbortSignal;
  readonly coarseFirst: boolean;
  readonly stayCoarse: boolean;
  readonly keepVertices: readonly number[];
  readonly bounds: Box3 | null;
  /** A same-file detail change keeps the existing camera and drawing. */
  readonly retain: boolean;
  readonly onProgress: (stage: DetailStage, fraction: number) => void;
  /** Allow the first drawing to be painted before background refinement. */
  readonly painted: () => Promise<void>;
}

export async function loadDetail(renderer: Pick<PreviewRenderer, 'load'>, segments: SegmentList, options: DetailOptions): Promise<void> {
  const base = { signal: options.signal, bounds: options.bounds, segmentsPerChunk: 8192, budgetMs: 8 };
  const coarse = options.coarseFirst || options.stayCoarse;
  const stride = coarse ? Math.max(1, Math.ceil((segments.kinds.length - 1) / COARSE_SEGMENTS)) : 1;
  await renderer.load(segments, { ...base, retainUntilReady: options.retain, sampling: { stride, keepVertices: options.keepVertices } });
  if (options.signal.aborted) return;
  if (stride === 1) { options.onProgress('full', 1); return; }
  options.onProgress('coarse', 1);
  if (options.stayCoarse) return;
  await options.painted();
  if (options.signal.aborted) return;
  options.onProgress('refining', 0);
  await renderer.load(segments, { ...base, retainUntilReady: true, sampling: { stride: 1 }, onProgress: (fraction) => {
    if (!options.signal.aborted) options.onProgress('refining', fraction);
  } });
  if (!options.signal.aborted) options.onProgress('full', 1);
}
