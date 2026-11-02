/**
 * Sample G-code files for the Run view's preview: generated in the browser,
 * so nothing is fetched. They exist to show the preview and the job card;
 * they are examples, not tested programs, and nothing here can send them to
 * a machine (Phase 1 has no Start).
 */
export interface Sample {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly text: () => string;
}

const f = (n: number): string => (Math.round(n * 1000) / 1000).toString();

/** A 180 × 120 × 6.35 mm mounting plate: four drilled holes (T5), a centre pocket and a profile with tabs (T1). */
function mountingPlate(): string {
  const out: string[] = [
    '(mounting-plate.nc - sample - 3 operations)',
    '(Units mm. Work zero: stock front-left corner, top.)',
    'G21 G90 G17 G94',
    '(01 Drill mounting holes - T5 5 mm drill)',
    'T5 M6',
    'S10000 M3',
    'G0 Z5',
  ];
  for (const [x, y] of [[15, 15], [165, 15], [165, 105], [15, 105]] as const) {
    out.push(`G0 X${f(x)} Y${f(y)}`);
    for (const z of [-2, -4, -7.35]) out.push(`G1 Z${f(z)} F150`, 'G0 Z1');
    out.push('G0 Z5');
  }
  out.push('(02 Clear the centre pocket - T1 3.175 mm end mill)', 'M5', 'G0 Z15', 'T1 M6', 'S18000 M3', 'G0 Z5');
  const [x0, y0, x1, y1] = [50, 35, 130, 85];
  const step = 1.3;
  for (const z of [-1, -2, -3]) {
    out.push(`G0 X${f(x0)} Y${f(y0)}`, `G1 Z${f(z)} F300`);
    let dir = 1;
    for (let y = y0; y <= y1 + 1e-9; y += step) {
      out.push(`G1 X${f(dir > 0 ? x1 : x0)} Y${f(y)} F1500`);
      if (y + step <= y1 + 1e-9) out.push(`G1 Y${f(y + step)}`);
      dir = -dir;
    }
    out.push(`G1 X${f(x0)} Y${f(y0)}`, `G1 X${f(x1)}`, `G1 Y${f(y1)}`, `G1 X${f(x0)}`, `G1 Y${f(y0)}`, 'G0 Z5');
  }
  out.push('(03 Cut out with tabs - T1 3.175 mm end mill)');
  const r = 1.5875;
  const [px0, py0, px1, py1] = [-r, -r, 180 + r, 120 + r];
  for (const z of [-1.5, -3, -4.5, -6, -6.6]) {
    out.push(`G0 X${f(px0)} Y${f(py0)}`, `G1 Z${f(z)} F300`);
    const tabs = z < -5.5;
    const edge = (x: number, y: number, along: 'x' | 'y', from: number, to: number): void => {
      if (!tabs) {
        out.push(along === 'x' ? `G1 X${f(to)} Y${f(y)} F1200` : `G1 X${f(x)} Y${f(to)} F1200`);
        return;
      }
      const mid = (from + to) / 2;
      const a = mid - 4 * Math.sign(to - from);
      const b = mid + 4 * Math.sign(to - from);
      out.push(along === 'x' ? `G1 X${f(a)} Y${f(y)} F1200` : `G1 X${f(x)} Y${f(a)} F1200`);
      out.push(`G1 Z${f(-5.35)}`);
      out.push(along === 'x' ? `G1 X${f(b)}` : `G1 Y${f(b)}`);
      out.push(`G1 Z${f(z)}`);
      out.push(along === 'x' ? `G1 X${f(to)}` : `G1 Y${f(to)}`);
    };
    edge(px0, py0, 'x', px0, px1);
    edge(px1, py0, 'y', py0, py1);
    edge(px1, py1, 'x', px1, px0);
    edge(px0, py1, 'y', py1, py0);
    out.push('G0 Z5');
  }
  out.push('M5', 'G0 Z15', 'G0 X0 Y0', 'M30');
  return `${out.join('\n')}\n`;
}

/** A small engraved square with rounded corners: one tool, arcs. */
function testSquare(): string {
  const out: string[] = ['(test-square.nc - sample - 40 mm square, 2 mm corner arcs)', '(Single tool: the 3.175 mm end mill is already in the spindle.)', 'G21 G90 G17 G94', 'S16000 M3', 'G0 Z5', 'G0 X2 Y0'];
  for (const z of [-0.5, -1]) {
    out.push(`G1 Z${f(z)} F200`, 'G1 X38 F900', 'G3 X40 Y2 I0 J2', 'G1 Y38', 'G3 X38 Y40 I-2 J0', 'G1 X2', 'G3 X0 Y38 I0 J-2', 'G1 Y2', 'G3 X2 Y0 I2 J0');
  }
  out.push('G0 Z5', 'M5', 'G0 X0 Y0', 'M30');
  return `${out.join('\n')}\n`;
}

export const SAMPLES: readonly Sample[] = [
  { id: 'mounting-plate', name: 'mounting-plate.nc', title: 'Mounting plate', text: mountingPlate },
  { id: 'test-square', name: 'test-square.nc', title: 'Test square', text: testSquare },
];

export function sampleFile(sample: Sample): File {
  return new File([sample.text()], sample.name, { type: 'text/plain' });
}

export interface FileFacts {
  readonly toolChanges: readonly { readonly line: number; readonly tool: number | null }[];
  readonly tools: readonly number[];
  readonly spindle: readonly number[];
  readonly operations: readonly { readonly line: number; readonly name: string }[];
}

/**
 * Host-side facts from the file text for the job card: M6 lines with their T word (the same line or the
 * last T before it), the S words, and `(NN name …)` operation comments. Read only; bounded to the first
 * 400 000 lines.
 */
export function fileFacts(bytes: Uint8Array): FileFacts {
  const text = new TextDecoder().decode(bytes.length > 16_000_000 ? bytes.subarray(0, 16_000_000) : bytes);
  const lines = text.split('\n', 400_000);
  const toolChanges: { line: number; tool: number | null }[] = [];
  const tools = new Set<number>();
  const spindle = new Set<number>();
  const operations: { line: number; name: string }[] = [];
  let lastT: number | null = null;
  lines.forEach((raw, i) => {
    const comment = /^\s*\((\d{1,3})\s+([^()-]+?)\s*(?:-[^)]*)?\)\s*$/.exec(raw);
    if (comment !== null) operations.push({ line: i + 1, name: (comment[2] as string).trim() });
    const code = raw.replace(/\([^)]*\)/g, '').replace(/;.*/, '').toUpperCase();
    const t = /T\s*(\d+)/.exec(code);
    if (t !== null) {
      lastT = Number(t[1]);
      tools.add(lastT);
    }
    const s = /S\s*(\d+(?:\.\d+)?)/.exec(code);
    if (s !== null) spindle.add(Number(s[1]));
    if (/M0*6(?!\d)/.test(code)) toolChanges.push({ line: i + 1, tool: lastT });
  });
  return { toolChanges, tools: [...tools].sort((a, b) => a - b), spindle: [...spindle].sort((a, b) => a - b), operations };
}
