import { readFileSync, writeFileSync } from 'node:fs';
import { w1, w2Label, w2Tooltip, w13 } from '../../../packages/safety/src/strings.ts';
const root = import.meta.dirname;
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
let html = readFileSync(`${root}/index.template.html`, 'utf8');
for (const [key, value] of Object.entries({ W1: w1(), W2: w2Label(), W2TIP: w2Tooltip(), W13: w13() })) html = html.replaceAll(`{{${key}}}`, escape(value));
if (process.argv.includes('--check')) {
  if (readFileSync(`${root}/index.html`, 'utf8') !== html) throw new Error('Prototype safety copy is stale; run prepare.mjs');
} else writeFileSync(`${root}/index.html`, html);
