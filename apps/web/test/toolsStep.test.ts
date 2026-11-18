/**
 * Step 5 Tools (spec §6.3 step 5, amended by OD-42: no stock in the wizard) and the catalog as a whole page over
 * the wizard (owner, 2026-11-18, picture 147).
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { CatalogPage } from '../src/wizard/CatalogPage.ts';
import { Tools, TOOLS_LEAD, TOOLS_TITLE } from '../src/wizard/steps/Tools.ts';
import { newToolSince } from '../src/wizard/toolChoice.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';

describe('newToolSince', () => {
  it('picks the entry whose id was not there before, the newest when several were added', () => {
    const before = SEED_TOOLS.slice(0, 2);
    const added = SEED_TOOLS[2]!;
    const later = SEED_TOOLS[3]!;
    expect(newToolSince(before, [...before, added])).toBe(added);
    expect(newToolSince(before, [...before, added, later])).toBe(later);
    // The catalog closes on the tool added after it opened, even when another was added earlier in the step.
    expect(newToolSince([...before, added], [...before, added, later])).toBe(later);
    expect(newToolSince(before, before)).toBeNull();
    expect(newToolSince(before, [before[0]!])).toBeNull();
  });
});

describe('step 5 Tools (render)', () => {
  const base = { tool: null, onCatalog: () => undefined, onCreate: () => undefined };
  it('tools only: the two actions, no stock fields (OD-42)', () => {
    expect(TOOLS_TITLE).toBe('Tools');
    expect(TOOLS_LEAD).toBe('One tool is enough to run the demo.');
    const html = renderToString(h(Tools, base));
    expect(html).toContain('data-action="wizard-catalog"');
    expect(html).toContain('data-action="wizard-create-tool"');
    expect(html).not.toContain('wizard-add-stock');
    expect(html).not.toContain('wizard-num');
    expect(html).not.toMatch(/[Ss]tock/);
    expect(html).not.toMatch(/E-stop|never need|Saved in this browser/);
  });
  it('shows the chosen tool', () => {
    const entry = SEED_TOOLS[0]!;
    expect(renderToString(h(Tools, { ...base, tool: entry }))).toContain(`data-wizard="tool"><strong>T${entry.number} · `);
  });
});

describe('the catalog page over the wizard', () => {
  it('is a whole-page region with Back to setup and the catalog itself', () => {
    const html = renderToString(h(CatalogPage, { onBack: () => undefined }));
    expect(html).toMatch(/^<div class="wizard-catalog" role="region" aria-label="Tool catalog"/);
    expect(html).toMatch(/data-action="wizard-catalog-back"[^>]*>Back to setup</);
    expect(html).toContain('class="catalog-view"');
  });
});
