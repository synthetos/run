/**
 * The demo project (spec §6.4, R13): a name plate, a 60 × 30 mm pocket 1.5 mm deep centred on a 180 × 120 × 6.35 mm
 * MDF stock, with "run" engraved 0.6 mm into the pocket floor from the wordmark's own geometry at half scale. One
 * tool, the catalog ¼" two-flute end mill. Work zero is the stock's front-left-top corner, like samples.ts. Unlike
 * the samples this is a tested program: the sanitizer and the analyze engine pass it in demoProject.test.ts.
 * Pure: generators and records only.
 */
import { builtinMaterial, type MachineProfile, type ProjectSetup, type Stock, type Tool } from '@synthetos/library';
import { SEED_SETUP, type ToolEntry } from '../workspace/library.ts';

export const DEMO_NAME = 'Name plate';
export const DEMO_FILE_NAME = 'name-plate.nc';

/** The catalog ¼" two-flute flat end mill, as a tool record (R9). */
export const DEMO_TOOL: Tool = Object.freeze({
  id: 'demo.quarter-2f', version: 1, name: '1/4" 2-flute end mill', type: 'flat',
  geometry: { diameter: 6.35, shank: 6.35, flutes: 2, fluteLength: 19, overallLength: 50, stickout: 25 },
  toolMaterial: 'carbide', coating: 'uncoated', manufacturer: 'Synthetos catalog', partNumber: 'CAT-2F-0250',
  description: 'Two-flute up-cut end mill for wood, MDF and plastics.', notes: '', purchase: [], cuttingData: [], life: { minutes: 0, byMaterial: [] }, tags: [], images: [],
}) as Tool;

export const DEMO_STOCK: Stock = Object.freeze({ ...SEED_SETUP.stock, shape: 'block', width: 180, depth: 120, thickness: 6.35 }) as Stock;

const f = (n: number): string => (Math.round(n * 1000) / 1000).toString();
const TOOL_R = 3.175;
const POCKET = { x0: 60, y0: 45, x1: 120, y1: 75, depth: 1.5 };
const ENGRAVE_Z = -2.1;
const FEED = { plunge: 300, pocket: 1000, engrave: 800 };
const SAFE = 'G0 Z5';

/** The pocket: a zigzag at 0.6 D stepover inside the wall by the tool radius, two passes, then the wall. */
function pocket(out: string[]): void {
  const [x0, y0, x1, y1] = [POCKET.x0 + TOOL_R, POCKET.y0 + TOOL_R, POCKET.x1 - TOOL_R, POCKET.y1 - TOOL_R];
  const step = 3.8;
  for (const z of [-POCKET.depth / 2, -POCKET.depth]) {
    out.push(`G0 X${f(x0)} Y${f(y0)}`, `G1 Z${f(z)} F${FEED.plunge}`);
    let dir = 1;
    for (let y = y0; y <= y1 + 1e-9; y += step) {
      out.push(`G1 X${f(dir > 0 ? x1 : x0)} Y${f(y)} F${FEED.pocket}`);
      if (y + step <= y1 + 1e-9) out.push(`G1 Y${f(y + step)}`);
      dir = -dir;
    }
    out.push(`G1 X${f(x0)} Y${f(y1)}`, `G1 Y${f(y0)}`, `G1 X${f(x1)}`, `G1 Y${f(y1)}`, `G1 X${f(x0)}`, SAFE);
  }
}

/**
 * "run" from the wordmark geometry (brand/wordmarkGeometry.ts: x 4..60, y 16..40, y down) at half scale, centred in
 * the pocket. The picture is kept as drawn, so an SVG clockwise arc (sweep 1) is G2 and sweep 0 is G3.
 */
function engrave(out: string[]): void {
  const s = 0.5;
  const gx = (x: number): number => 90 + (x - 32) * s;
  const gy = (y: number): number => 60 - (y - 28) * s;
  const to = (x: number, y: number): string => `X${f(gx(x))} Y${f(gy(y))}`;
  const start = (x: number, y: number): void => { out.push(`G0 ${to(x, y)}`, `G1 Z${f(ENGRAVE_Z)} F${FEED.plunge}`); };
  const line = (x: number, y: number): void => { out.push(`G1 ${to(x, y)} F${FEED.engrave}`); };
  /** An arc to `end` whose centre is `i` geometry units right of the start (the three arcs all start level with their centre). */
  const arc = (code: 'G2' | 'G3', end: readonly [number, number], i: number): void => { out.push(`${code} ${to(end[0], end[1])} I${f(i * s)} J0 F${FEED.engrave}`); };
  // r: stem, then the shoulder (M4 25 a9 9 0 0 1 9 -9: centre (13, 25)).
  start(4, 40); line(4, 16); out.push(SAFE);
  start(4, 25); arc('G2', [13, 16], 9); out.push(SAFE);
  // u: right stem to the baseline, then the left stem and the bowl (a8 8 0 0 0 16 0: centre (28, 32)).
  start(36, 16); line(36, 40); out.push(SAFE);
  start(20, 16); line(20, 32); arc('G3', [36, 32], 8); line(36, 16); out.push(SAFE);
  // n: the stem (solid here; dotted only in the logo), then the arch (a8 8 0 0 1 16 0: centre (52, 24)) and the right stem.
  start(44, 16); line(44, 40); out.push(SAFE);
  start(44, 24); arc('G2', [60, 24], 8); line(60, 40); out.push(SAFE);
}

export function demoGcode(): string {
  const out: string[] = [
    `(${DEMO_FILE_NAME} - demo - 2 operations)`,
    '(Units mm. Work zero: stock front-left corner, top. Stock 180 x 120 x 6.35 MDF.)',
    'G21 G90 G17 G94',
    '(01 Pocket - T1 6.35 mm end mill)',
    'T1 M6',
    'S16000 M3',
    SAFE,
  ];
  pocket(out);
  out.push('(02 Engrave run - T1 6.35 mm end mill)');
  engrave(out);
  out.push('M5', 'G0 Z15', 'G0 X0 Y0', 'M30');
  return `${out.join('\n')}\n`;
}

export function demoFile(): File {
  return new File([demoGcode()], DEMO_FILE_NAME, { type: 'text/plain' });
}

/** The project's setup references: the machine when there is one, the stock with its snapshot, MDF, the tool. */
export function demoSetup(machine: MachineProfile | null, tool: ToolEntry, stock: Stock): ProjectSetup {
  const mdf = builtinMaterial('builtin.mdf');
  return {
    machine: machine === null ? null : { id: machine.id, name: machine.name },
    stock: { id: 'stock', name: `Block ${f(stock.width)} × ${f(stock.depth)} × ${f(stock.thickness)} mm` },
    stockSnapshot: stock,
    material: mdf === undefined ? null : { id: mdf.id, version: mdf.version, name: mdf.name },
    tools: [{ id: tool.tool.id, version: tool.tool.version, name: tool.tool.name, number: tool.number }],
  };
}
