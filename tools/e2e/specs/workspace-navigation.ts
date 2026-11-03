import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

/** Follow the visible Job/Library navigation when visiting an existing feature. */
export function workspaceDestination(view: string): string {
  return view === 'run' || view === 'setup' ? 'job' : ['machines', 'tools', 'materials'].includes(view) ? 'library' : view;
}
export async function showWorkspace(page: Page, view: string): Promise<void> {
  const target = workspaceDestination(view);
  await page.locator(`[data-region="rail"] [data-view="${target}"]`).click();
  await expect(page.locator(`[data-screen="${target}"]`)).toBeVisible();
  if (target === 'library' && view !== 'library') await page.locator(`#library-tab-${view}`).click();
  if (view === 'setup' || view === 'run') await page.locator(`[data-job-step="${view === 'setup' ? 'stock' : 'run'}"]`).click();
}
