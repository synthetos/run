// Sample project data for the design study: machine, bed, fixture, stock,
// materials, tool library, operations and their toolpaths. Everything here is
// illustrative. It is not CAM output, not interpreter output and not a
// machining prescription.

export const materials = {
  al6061: { name: '6061 aluminium', family: 'metal', color: [196, 205, 212], vc: [100, 300], fzPerD: 0.008, docSlot: 0.25, mrrHobby: 2.0, coolantMatters: true },
  mdf: { name: 'MDF', family: 'wood', color: [184, 150, 112], vc: [300, 900], fzPerD: 0.035, docSlot: 1.0, mrrHobby: 40, coolantMatters: false },
  plywood: { name: 'Birch plywood', family: 'wood', color: [222, 196, 150], vc: [300, 900], fzPerD: 0.03, docSlot: 1.0, mrrHobby: 35, coolantMatters: false },
  maple: { name: 'Hardwood · maple', family: 'wood', color: [226, 200, 152], vc: [250, 700], fzPerD: 0.025, docSlot: 0.75, mrrHobby: 25, coolantMatters: false },
  walnut: { name: 'Hardwood · walnut', family: 'wood', color: [122, 92, 70], vc: [250, 700], fzPerD: 0.025, docSlot: 0.75, mrrHobby: 25, coolantMatters: false },
  acrylic: { name: 'Cast acrylic', family: 'plastic', color: [178, 210, 228], vc: [150, 500], fzPerD: 0.02, docSlot: 0.5, mrrHobby: 15, coolantMatters: true },
  hdpe: { name: 'HDPE', family: 'plastic', color: [232, 232, 226], vc: [200, 600], fzPerD: 0.03, docSlot: 1.0, mrrHobby: 25, coolantMatters: false },
  brass: { name: 'Brass 360', family: 'metal', color: [205, 172, 92], vc: [90, 250], fzPerD: 0.01, docSlot: 0.25, mrrHobby: 2.5, coolantMatters: true },
};

// The cloud tool library is host-side only. Firmware knows only the active
// tool number (T word, "tool" in the status report) and G43/G49 length.
export const tools = [
  { id: 'T1', number: 1, type: 'flat', name: '3.175 mm flat end mill', diameter: 3.175, flutes: 2, fluteLength: 12, overall: 38, shank: 3.175, material: 'Carbide', coating: 'Uncoated', vendor: 'Generic', synced: true },
  { id: 'T2', number: 2, type: 'flat', name: '6 mm flat end mill', diameter: 6, flutes: 3, fluteLength: 18, overall: 50, shank: 6, material: 'Carbide', coating: 'ZrN', vendor: 'Generic', synced: true },
  { id: 'T3', number: 3, type: 'ball', name: '3.175 mm ball nose', diameter: 3.175, flutes: 2, fluteLength: 12, overall: 38, shank: 3.175, material: 'Carbide', coating: 'AlTiN', vendor: 'Generic', synced: true },
  { id: 'T4', number: 4, type: 'vbit', name: '60° V-bit', diameter: 12.7, flutes: 2, fluteLength: 11, overall: 45, shank: 6.35, angle: 60, material: 'Carbide', coating: 'Uncoated', vendor: 'Generic', synced: true },
  { id: 'T5', number: 5, type: 'drill', name: '5 mm jobber drill', diameter: 5, flutes: 2, fluteLength: 52, overall: 86, shank: 5, angle: 118, material: 'HSS-Co', coating: 'TiN', vendor: 'Generic', synced: true },
  { id: 'T6', number: 6, type: 'oflute', name: '6.35 mm O-flute', diameter: 6.35, flutes: 1, fluteLength: 22, overall: 63, shank: 6.35, material: 'Carbide', coating: 'Uncoated', vendor: 'Generic', synced: false },
];
export const toolKinds = { flat: 'End mill', ball: 'Ball nose', vbit: 'V-bit', drill: 'Drill', oflute: 'O-flute' };

export const machine = {
  name: 'Workshop router', controller: 'TinyG v8', drive: 'belt', rigidity: 'hobby',
  travel: { x: 750, y: 750, z: 95 }, spindle: { kind: 'Trim router', minRpm: 10000, maxRpm: 30000, powerW: 710 },
};

export const setup = {
  bed: { width: 790, depth: 790, thickness: 19, material: 'MDF spoilboard' },
  fixtures: [
    { id: 'fx1', name: 'Fixture plate', source: 'fixture-plate.dxf', x: 160, y: 120, height: 12, material: 'MDF', outline: null, holes: null },
  ],
  stock: { shape: 'block', width: 180, depth: 120, thickness: 6.35, diameter: 150, material: 'al6061', x: 220, y: 160, zeroCorner: 'front-left', zeroTop: true },
  clamps: true,
};

// A fixture drawing as a parsed DXF would return it: one outline and holes.
export function sampleFixture(width = 300, depth = 200) {
  const r = 10;
  const outline = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * Math.PI / 2; outline.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(width - r, r, -Math.PI / 2); corner(width - r, depth - r, 0); corner(r, depth - r, Math.PI / 2); corner(r, r, Math.PI);
  const holes = [];
  for (let x = 25; x < width; x += 50) for (let y = 25; y < depth; y += 50) holes.push([x, y, 3]);
  return { outline, holes, width, depth };
}

function roundedRect(x0, y0, x1, y1, r, steps = 8) {
  const pts = [];
  const arc = (cx, cy, a0) => { for (let i = 0; i <= steps; i++) { const a = a0 + (i / steps) * Math.PI / 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  arc(x1 - r, y0 + r, -Math.PI / 2); arc(x1 - r, y1 - r, 0); arc(x0 + r, y1 - r, Math.PI / 2); arc(x0 + r, y0 + r, Math.PI);
  pts.push(pts[0]);
  return pts;
}

// Toolpaths in work coordinates: origin at the stock's top front-left corner.
// Each move: [x, y, z, rapid?, line]. The G-code text is generated alongside.
function buildOperations() {
  const safe = 5;
  const ops = [];
  { // 01 drill
    const moves = []; const g = ['(01 Drill mounting holes · T5 5 mm drill)', 'G21 G90 G17', 'T5 M6', 'S10000 M3', `G0 Z${safe}`];
    for (const [x, y] of [[20, 20], [160, 20], [160, 100], [20, 100]]) {
      moves.push([x, y, safe, true]); g.push(`G0 X${x} Y${y}`);
      for (let z = -1; z >= -6.6; z -= 1) { const zz = Math.max(z, -6.6); moves.push([x, y, zz, false]); moves.push([x, y, 1, true]); g.push(`G1 Z${zz.toFixed(2)} F150`, 'G0 Z1'); }
      moves.push([x, y, -6.6, false]); moves.push([x, y, safe, true]); g.push('G1 Z-6.60 F150', `G0 Z${safe}`);
    }
    g.push('M5', 'M30');
    ops.push({ id: 'drill', number: '01', name: 'Drill mounting holes', file: 'plate-drill.nc', version: 2, tool: 'T5', rpm: 10000, feed: 150, plunge: 150, doc: 1, woc: 5, coolant: 'none', moves, gcode: g });
  }
  { // 02 pocket: one 2 mm pass, zigzag, then a faceted finishing lap.
    const moves = []; const g = ['(02 Pocket · T1 3.175 mm flat end mill)', 'G21 G90 G17', 'T1 M6', 'S18000 M3', `G0 Z${safe}`];
    const r = 1.5875, x0 = 50 + r, x1 = 130 - r, y0 = 40 + r, y1 = 80 - r, z = -2;
    moves.push([x0 + 1, y0 + 1, safe, true]); g.push(`G0 X${(x0 + 1).toFixed(3)} Y${(y0 + 1).toFixed(3)}`);
    moves.push([x0 + 1, y0 + 1, z, false]); g.push(`G1 Z${z.toFixed(3)} F300`);
    let dir = 1;
    for (let y = y0 + 1; y <= y1 - 1 + 1e-6; y += 1.27) {
      const xa = dir > 0 ? x0 + 1 : x1 - 1, xb = dir > 0 ? x1 - 1 : x0 + 1;
      moves.push([xa, y, z, false]); moves.push([xb, y, z, false]);
      g.push(`G1 X${xa.toFixed(3)} Y${y.toFixed(3)} F1500`, `G1 X${xb.toFixed(3)}`);
      dir = -dir;
    }
    for (const [x, y] of roundedRect(x0, y0, x1, y1, 0.8, 16)) { moves.push([x, y, z, false]); g.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F1500`); }
    moves.push([moves.at(-1)[0], moves.at(-1)[1], safe, true]); g.push(`G0 Z${safe}`, 'M5', 'M30');
    ops.push({ id: 'pocket', number: '02', name: 'Clear the centre pocket', file: 'plate-pocket.nc', version: 3, tool: 'T1', rpm: 18000, feed: 1500, plunge: 300, doc: 2, woc: 3.175, coolant: 'none', moves, gcode: g });
  }
  { // 03 contour with tabs
    const moves = []; const g = ['(03 Cut out with tabs · T1 3.175 mm flat end mill)', 'G21 G90 G17', 'T1 M6', 'S18000 M3', `G0 Z${safe}`];
    const r = 1.5875; const path = roundedRect(10 - r, 10 - r, 170 + r, 110 + r, 8 + r, 10);
    const tabTop = -6.6 + 1.6;
    const tabs = [[90, 10 - r], [90, 110 + r], [10 - r, 60], [170 + r, 60]];
    const nearTab = (x, y) => tabs.some(([tx, ty]) => Math.abs(tx - x) < 4.5 + r && Math.abs(ty - y) < 4.5 + r);
    moves.push([path[0][0], path[0][1], safe, true]); g.push(`G0 X${path[0][0].toFixed(3)} Y${path[0][1].toFixed(3)}`);
    for (let zp = -0.5; zp >= -6.6 - 1e-6; zp -= 0.5) {
      const zz = Math.max(zp, -6.6);
      for (let i = 0; i < path.length - 1; i++) {
        const [ax, ay] = path[i], [bx, by] = path[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
        for (let k = 0; k <= n; k++) {
          const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n;
          const zc = zz < tabTop && nearTab(x, y) ? tabTop : zz;
          moves.push([x, y, zc, false]);
        }
        g.push(`G1 X${bx.toFixed(3)} Y${by.toFixed(3)} Z${zz.toFixed(3)} F900`);
      }
    }
    moves.push([path[0][0], path[0][1], safe, true]); g.push(`G0 Z${safe}`, 'M5', 'M30');
    ops.push({ id: 'contour', number: '03', name: 'Cut out with tabs', file: 'plate-contour.nc', version: 3, tool: 'T1', rpm: 18000, feed: 900, plunge: 250, doc: 0.5, woc: 3.175, coolant: 'none', moves, gcode: g });
  }
  for (const op of ops) {
    let length = 0, seconds = 0;
    for (let i = 1; i < op.moves.length; i++) {
      const [ax, ay, az] = op.moves[i - 1], [bx, by, bz, rapid] = op.moves[i];
      const d = Math.hypot(bx - ax, by - ay, bz - az); length += d;
      const f = rapid ? 4000 : (bx === ax && by === ay ? op.plunge : op.feed);
      seconds += d / f * 60 * (rapid ? 1 : 1.18); // acceleration allowance, an estimate
    }
    op.length = length; op.seconds = Math.round(seconds);
  }
  return ops;
}
export const operations = buildOperations();
export const opById = Object.fromEntries(operations.map((o) => [o.id, o]));
export const toolById = (id) => tools.find((t) => t.id === id);

export function fmtTime(s) { const m = Math.floor(s / 60); return m ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`; }

// Feeds and speeds advisor: a stand-in for a later engine. Simple published
// rules of thumb, scaled for a hobby router. Illustrative only.
export function advise(op, tool, materialId, coolant, mach = machine) {
  const m = materials[materialId];
  const z = tool.flutes, d = tool.diameter;
  const fz = op.feed / (op.rpm * z);
  const vc = Math.PI * d * op.rpm / 1000;
  const mrr = op.woc * op.doc * op.feed / 1000; // cm³/min
  const rigid = mach.rigidity === 'hobby' ? 1 : 1.8;
  const cool = coolant === 'none' && m.coolantMatters ? 0.8 : 1;
  const fzTarget = m.fzPerD * d * (tool.type === 'drill' ? 0.6 : 1);
  const docMax = (op.woc >= d * 0.95 ? m.docSlot : m.docSlot * 3) * d * rigid * cool;
  const mrrMax = m.mrrHobby * rigid * cool;
  const findings = [];
  if (tool.type !== 'drill') {
    if (op.doc > docMax * 1.05) findings.push({ level: 'high', text: `Depth of cut ${op.doc} mm is ${Math.round(op.doc / d * 100)} % of the tool diameter in a full-width slot. Keep to about ${docMax.toFixed(1)} mm here.` });
    if (fz > fzTarget * 1.4) findings.push({ level: 'high', text: `Chip load ${fz.toFixed(3)} mm per tooth is high for a ${d} mm tool in ${m.name} (about ${fzTarget.toFixed(3)} expected).` });
    else if (fz < fzTarget * 0.45) findings.push({ level: 'medium', text: `Chip load ${fz.toFixed(3)} mm per tooth is low: the tool rubs and heats instead of cutting.` });
    if (mrr > mrrMax * 1.05) findings.push({ level: 'high', text: `Removal rate ${mrr.toFixed(1)} cm³/min is above what a belt-driven hobby machine holds in ${m.name} (about ${mrrMax.toFixed(1)}).` });
    if (vc > m.vc[1] * 1.1) findings.push({ level: 'medium', text: `Surface speed ${Math.round(vc)} m/min is above the usual range for ${m.name}.` });
  }
  if (coolant === 'none' && m.coolantMatters) findings.push({ level: 'medium', text: `No coolant: ${m.family === 'metal' ? 'aluminium welds to the flutes without mist or an air blast.' : 'acrylic melts and re-welds behind the cut without air.'}` });
  const high = findings.some((f) => f.level === 'high');
  const verdict = high ? 'Too aggressive' : findings.length ? 'Check' : 'Within range';
  const feed = Math.round(Math.min(op.feed, fzTarget * op.rpm * z) / 50) * 50;
  const doc = Math.min(op.doc, Math.floor(docMax * 4) / 4 || 0.25);
  const passes = Math.ceil((op.id === 'pocket' ? 2 : op.doc) / doc);
  return { fz, vc, mrr, verdict, findings, suggestion: high ? { feed, doc, passes, coolant: m.coolantMatters ? 'mist or air blast' : coolant, mrr: op.woc * doc * feed / 1000 } : null };
}

// One file, three operations, two tools. The host stops before each M6,
// waits for stat idle with an empty queue, shows the tool-change card, sends
// the M6 line after the operator confirms, then resumes streaming.
function buildJob() {
  const lines = ['(mounting-plate.nc · version 3 · 3 operations)'];
  const segments = []; const changes = [];
  let active = null; let movesTotal = 0;
  for (const op of operations) {
    const start = lines.length + 1;
    for (const text of op.gcode) {
      const m = /\bT(\d+)\b.*\bM6\b/.exec(text);
      if (m) {
        const to = `T${m[1]}`;
        if (to !== active) changes.push({ line: lines.length + 1, from: active, to, op: op.id, known: !!toolById(to) });
        active = to;
      }
      lines.push(text);
    }
    segments.push({ op: op.id, start, end: lines.length, seconds: op.seconds, moveStart: movesTotal, moves: op.moves.length });
    movesTotal += op.moves.length;
  }
  const changeSeconds = 90; // allowance per manual change, an estimate
  const seconds = segments.reduce((a, s) => a + s.seconds, 0) + changes.length * changeSeconds;
  return { file: 'mounting-plate.nc', version: 3, lines, segments, changes, seconds, changeSeconds };
}
export const job = buildJob();
// Map an overall fraction of the job's time to {op, upto} per operation.
export function progressAt(f) {
  const total = job.seconds; let t = f * total; const out = [];
  for (const seg of job.segments) {
    const ch = job.changes.find((c) => c.op === seg.op);
    if (ch) t -= job.changeSeconds;
    const upto = Math.max(0, Math.min(1, t / seg.seconds));
    out.push({ op: opById[seg.op], upto, seg });
    t -= seg.seconds;
  }
  return out;
}
