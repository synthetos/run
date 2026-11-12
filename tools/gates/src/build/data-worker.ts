/** Dependency-free build of the reviewed data Worker and its schema readers, inside the attested archive. */
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
const PACKAGES: Readonly<Record<string,string>> = { '@synthetos/library': 'packages/library/src/index.ts', '@synthetos/contracts': 'packages/contracts/src/index.ts', '@synthetos/schema/json-schema': 'packages/schema/src/jsonSchema.ts' };
const ALLOWED = /^(?:workers\/run-data\/src\/|packages\/(?:library|contracts)\/src\/|packages\/schema\/src\/jsonSchema\.ts$)/;
export function buildDataWorker(root: string, out: string): void {
  const seen = new Set<string>();
  const outputName = (file: string): string => file === 'workers/run-data/src/index.ts' ? 'index.mjs' : file.replaceAll('/', '_').replace(/\.ts$/, '.mjs');
  function build(file: string): void {
    if (seen.has(file)) return; seen.add(file);
    if (!ALLOWED.test(file) || !file.endsWith('.ts')) throw new Error(`data worker: refused source ${file}`);
    const erased = stripTypeScriptTypes(readFileSync(join(root,file),'utf8'), {mode:'strip'});
    if (/\bimport\s*\(|\brequire\s*\(/.test(erased)) throw new Error('data worker: dynamic imports refused');
    const code = erased.replace(/\b(from|import)(\s*)(['"])([^'"\n]*)\3/g, (_all, verb: string, gap: string, quote: string, spec: string) => {
      if (spec === 'cloudflare:workers' && file === 'workers/run-data/src/index.ts') return `${verb}${gap}${quote}${spec}${quote}`;
      const target = PACKAGES[spec] ?? (spec.startsWith('./') ? relative(root,resolve(root,dirname(file),spec)) : null);
      if (target === null) throw new Error(`data worker: refused import ${spec}`);
      build(target);
      const path = './'+outputName(target);
      return `${verb}${gap}${quote}${path}${quote}`;
    });
    const destination = join(out,outputName(file)); mkdirSync(dirname(destination),{recursive:true}); writeFileSync(destination,code);
  }
  build('workers/run-data/src/index.ts');
}
