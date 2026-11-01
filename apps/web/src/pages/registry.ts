import { h, type ComponentChild } from 'preact';
import type { BuildInfo } from '../build-info/buildInfo.ts';
import { Shell } from '../shell/Shell.ts';
import { NotFoundPage } from './not-found/NotFoundPage.ts';
import { PrivacyPage } from './privacy/PrivacyPage.ts';
import { SafetyPage } from './safety/SafetyPage.ts';

/**
 * Every HTML page of the build and what is prerendered into it, keyed by the
 * page's path relative to the web root (the Vite inputs in vite.config.ts).
 */
export const PAGES: Readonly<Record<string, (build: BuildInfo) => ComponentChild>> = Object.freeze({
  '/index.html': (build: BuildInfo) => h(Shell, { build }),
  '/safety/index.html': (build: BuildInfo) => h(SafetyPage, { build }),
  '/privacy/index.html': (build: BuildInfo) => h(PrivacyPage, { build }),
  '/404.html': (build: BuildInfo) => h(NotFoundPage, { build }),
});
