/**
 * The stock to carve (docs/design/tool-sim.md, slice 2): the scene's stock
 * solid (a box or prism in machine coordinates, already moved by the live
 * placement when there is one) taken into the path frame by the scene's
 * path offset, as the heightmap's grid. Pure. Display only.
 *
 * It does not decide the cell size's rules (gcode-view carve/heightmap.ts)
 * and it says nothing about whether the stock is really there.
 */
import { gridSpec, type GridSpec, type Pt2, type SceneLayers, type Vec3 } from '@synthetos/gcode-view';

/** The heightmap grid over the scene's stock in the path frame, or null with no stock. */
export function carveGrid(layers: SceneLayers | null, pathOffset: Vec3): GridSpec | null {
  const stock = layers?.solids.find((s) => s.tag === 'stock');
  if (stock === undefined) return null;
  const [ox, oy, oz] = pathOffset;
  if (stock.kind === 'box') {
    return gridSpec({ min: [stock.min[0] - ox, stock.min[1] - oy], max: [stock.max[0] - ox, stock.max[1] - oy], top: stock.max[2] - oz, bottom: stock.min[2] - oz, outline: null });
  }
  if (stock.outline.length < 3) return null;
  const outline: Pt2[] = stock.outline.map(([x, y]) => [x - ox, y - oy]);
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  return gridSpec({ min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)], top: stock.z1 - oz, bottom: stock.z0 - oz, outline });
}
