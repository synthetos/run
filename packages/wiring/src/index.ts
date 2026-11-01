/**
 * @synthetos/wiring
 *
 * Wiring diagrams: board data, component library, rules engine and renderers.
 *
 * This package has no runtime npm dependencies (RUN_PLAN §5.3).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

export * from './board.ts';
export * from './components.ts';
export * from './diagram.ts';
export * from './rules.ts';
export * from './expectedSettings.ts';
export * from './checklist.ts';
export * from './render.ts';
