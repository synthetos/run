/** The job analysis report (docs/design/ANALYZE.md slice 1): motion facts from the interpreter's event tape. */
export * from './types.ts';
export { DENSE_LINES_PER_SECOND, DENSE_RULES, MIN_DENSE_LINES, MIN_DENSE_SECONDS, SLOW_RULES, denseRegions, densityBuckets } from './density.ts';
export { operations } from './operations.ts';
export { analyzeProgram, motionTime } from './report.ts';
