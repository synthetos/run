/**
 * pnpm gen:brand — writes the standalone wordmark and mark SVGs under apps/web/src/brand/ from svg.ts and the theme
 * tokens. The files are committed; tools/gates/test/brand-svg.test.ts fails when they no longer match a fresh render.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_DIR, BRAND_FILES, brandColours } from './svg.ts';
import { loadThemes } from '../tokens/theme.ts';

const colours = brandColours(loadThemes());
for (const f of BRAND_FILES) {
  writeFileSync(join(BRAND_DIR, f.file), f.render(colours[f.theme]));
  process.stdout.write(`gen:brand: wrote ${f.file}\n`);
}
