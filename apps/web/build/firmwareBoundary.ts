/** SAFETY §4.8 (owner 2026-11-14): the open entry never includes workspace control code. */
import type { Plugin } from 'vite';

export interface FirmwareChunk {
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly modules: Readonly<Record<string, { readonly renderedLength: number }>>;
  readonly code: string;
}

/** Inspect rendered modules, including every shared and lazy chunk reachable from an entry. */
export function checkFirmwareGraph(chunks: Readonly<Record<string, FirmwareChunk>>, roots: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const failures: string[] = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const chunk = chunks[file];
    if (chunk === undefined) { failures.push(`missing update chunk ${file}`); return; }
    for (const [id, module] of Object.entries(chunk.modules)) {
      if (module.renderedLength === 0) continue;
      const path = id.replaceAll('\\', '/');
      if (/\/session\/(?:motion[^/]*|job[^/]*|typed[^/]*|probe\/.*)\.ts$/.test(path) || /\/(?:console|jog|probe|job)\//.test(path) || /\/(?:Jog|Job|Probe|Console)[^/]*\.ts$/.test(path)) failures.push(`control module in update graph: ${path}`);
    }
    // This literal is the write gate's command kind, not the word in explanatory prose.
    if (/(?:kind|["']kind["'])\s*:\s*["']motion["']/.test(chunk.code)) failures.push(`motion command kind in update graph: ${file}`);
    for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) visit(dependency);
  };
  for (const root of roots) visit(root);
  return failures;
}

/** Install in both the page build and the separate firmware worker build. */
export function firmwareBoundary(): Plugin {
  return {
    name: 'firmware-only-boundary',
    generateBundle(_options, bundle) {
      const chunks: Record<string, FirmwareChunk> = {};
      const roots: string[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        chunks[item.fileName] = item;
        if (item.isEntry && /\/(?:src\/entries\/update\.ts|update\/index\.html|firmware\.worker\.ts)$/.test((item.facadeModuleId ?? '').replaceAll('\\', '/'))) roots.push(item.fileName);
      }
      const failures = checkFirmwareGraph(chunks, roots);
      if (failures.length > 0) this.error(failures.join('\n'));
    },
  };
}
