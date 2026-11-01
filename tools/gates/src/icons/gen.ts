/**
 * pnpm gen:icons — renders apps/web/public/icons/*.png from draw.ts. The
 * files are committed; tools/gates/test/manifest.test.ts fails when they no
 * longer match a fresh render.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ICONS, drawIcon } from './draw.ts';
import { encodePng } from './png.ts';

const dir = resolve(import.meta.dirname, '../../../../apps/web/public/icons');
mkdirSync(dir, { recursive: true });
for (const icon of ICONS) {
  writeFileSync(join(dir, icon.file), encodePng(drawIcon(icon.size, icon.variant)));
  process.stdout.write(`gen:icons: wrote ${icon.file}\n`);
}
