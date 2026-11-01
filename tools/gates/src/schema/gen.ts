/**
 * Writes packages/schema/src/generated/{den,d440,d449}.ts from the vendored
 * HIL tables (ROADMAP P0-09; RUN_PLAN §8.2).
 *
 *   pnpm gen:schema
 *
 * The modules are committed. tools/gates/test/schema-tables.test.ts fails
 * whenever a committed module differs from a fresh render, so the schema can
 * never drift from vendor/tinyg-hil-tables/.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATED_DIR, renderAll } from './all.ts';

for (const [name, text] of renderAll()) {
  const target = join(GENERATED_DIR, `${name}.ts`);
  writeFileSync(target, text);
  process.stdout.write(`gen-schema: wrote ${target}\n`);
}
