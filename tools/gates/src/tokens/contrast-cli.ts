/**
 * pnpm gen:contrast — writes docs/design/contrast.md from tokens.css and
 * fails (exit 1) if any pair is below its minimum.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate, renderTable } from './contrast.ts';
import { REPO_ROOT, loadThemes } from './theme.ts';

const rows = evaluate(loadThemes());
const target = join(REPO_ROOT, 'docs/design/contrast.md');
writeFileSync(target, renderTable(rows));
const failing = rows.filter((r) => !r.pass);
for (const r of failing) process.stderr.write(`gen:contrast: ${r.theme} ${r.fg} on ${r.pair.bg} is ${r.ratio.toFixed(2)}:1, below ${r.pair.kind} minimum\n`);
process.stdout.write(`gen:contrast: wrote ${target} (${rows.length} rows, ${failing.length} failing)\n`);
process.exitCode = failing.length > 0 ? 1 : 0;
