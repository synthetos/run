import type { BuildInfo } from './build-info/buildInfo.ts';

declare global {
  /** Replaced at build time by Vite `define` (vite.config.ts, build/buildInfo.ts). */
  const __RUN_BUILD__: BuildInfo;
}
