import { expect, it } from 'vitest';
import { checkFirmwareGraph, type FirmwareChunk } from '../build/firmwareBoundary.ts';
const chunk = (modules: readonly string[] = [], imports: readonly string[] = [], dynamicImports: readonly string[] = [], code = ''): FirmwareChunk => ({ imports, dynamicImports, code, modules: Object.fromEntries(modules.map(id => [id, { renderedLength: 1 }])) });
it('walks shared and lazy chunks, including cycles, without admitting control code', () => {
  const graph = { entry: chunk(['/src/update.ts'], ['shared']), shared: chunk([], [], ['lazy']), lazy: chunk(['/session/job.ts'], ['entry']) };
  expect(checkFirmwareGraph(graph, ['entry'])).toEqual(['control module in update graph: /session/job.ts']);
});
it.each(['/session/motion.ts', '/session/motionLines.ts', '/session/jobModes.ts', '/session/probe/run.ts', '/src/console/run.ts', '/src/jog/view.ts', '/src/ProbePanel.ts', '/session/typedMove.ts'])('rejects %s', path => {
  expect(checkFirmwareGraph({ entry: chunk([path]) }, ['entry'])).toHaveLength(1);
});
it('checks the motion kind even if a module is renamed', () => {
  expect(checkFirmwareGraph({ entry: chunk(['/safe.ts'], [], [], 'return {kind:"motion"}') }, ['entry'])).toHaveLength(1);
});
it('ignores fully tree-shaken modules and allows identity/flash code', () => {
  expect(checkFirmwareGraph({ entry: { ...chunk(['/flashService.ts', '/protocol/probe.ts']), modules: { '/session/motion.ts': { renderedLength: 0 } } } }, ['entry'])).toEqual([]);
});
it('fails closed on an unresolved chunk', () => {
  expect(checkFirmwareGraph({}, ['missing'])).toEqual(['missing update chunk missing']);
});
