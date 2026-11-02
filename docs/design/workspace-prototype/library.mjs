// Tool and material library for the design study (MACHINING_ASSISTANT.md §2,
// §3, §8). Every number here is a PLACEHOLDER until it is sourced (owner
// decision §10.5): it shows the shape of the data, not machining advice.
// No network: links are stored and rendered, never fetched.

// ---------- URLs (§8) ----------
// Purchase and datasheet links accept http(s) only. They render as plain
// external links that open in a new tab with noopener, noreferrer, nofollow.
export function safeUrl(raw) {
  if (raw == null) return null;
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.href;
  } catch { return null; }
}
export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
export const storeUrl = (sku) => `https://synthetos.myshopify.com/search?q=${encodeURIComponent(sku)}`;

// ---------- Materials (§3) ----------
// fz: balanced chipload (mm/tooth) by tool diameter for carbide on a hobby
// frame. Conservative is 0.8x, aggressive 1.25x. ap: maximum axial depth in a
// full-width slot as a fraction of D, per frame class (doubled when ae <= D/2).
const PLACEHOLDER = { source: 'Placeholder, not yet cited', version: '0.1', placeholder: true };
const wood = (extra = []) => [{ level: 'warn', text: 'Wood dust: use dust extraction.' }, ...extra];
function M(id, o) {
  return {
    id, version: o.version ?? 1, source: 'builtin', name: o.name, family: o.family, grade: o.grade ?? '', color: o.color,
    physical: o.physical, cutting: o.cutting ?? [], coolant: o.coolant, behaviour: o.behaviour ?? [], safety: o.safety ?? [],
    stockForms: o.stockForms ?? [], purchase: [], description: o.description ?? '', notes: '', citation: o.citation ?? PLACEHOLDER,
    doNotMachine: !!o.doNotMachine,
  };
}
const carbide = (vc, fz, ap, ae = { hobby: 0.4, medium: 0.5, rigid: 0.5 }) => ({ toolMaterial: 'carbide', vc, fz, ap, ae });
export const families = {
  aluminium: 'Aluminium', brass: 'Brass and copper', plastic: 'Plastics', wood: 'Wood', composite: 'Composites', foam: 'Foam', pcb: 'PCB',
};
export const builtinMaterials = [
  M('al6061', { version: 3, name: '6061 aluminium', family: 'aluminium', grade: '6061-T6', color: [196, 205, 212], physical: { hardness: '95 HB', density: 2.7, kc: 700, mc: 0.25 },
    cutting: [carbide([150, 300], [[1, 0.006], [3.175, 0.025], [6.35, 0.04], [12.7, 0.06]], { hobby: 0.2, medium: 0.5, rigid: 1.0 }), { toolMaterial: 'hss', vc: [60, 100], fz: [[3.175, 0.015], [6.35, 0.025], [12.7, 0.04]], ap: { hobby: 0.15, medium: 0.3, rigid: 0.6 }, ae: { hobby: 0.3, medium: 0.4, rigid: 0.5 } }],
    coolant: { need: 'required', reason: 'Aluminium welds to the flutes without an air blast or mist.' },
    behaviour: ['Gummy: chips weld to the flutes when they get hot', 'Clear the chips: recutting them breaks small tools', 'Single or 2-flute tools with polished or ZrN flutes cut best'],
    safety: [{ level: 'warn', text: 'Hot, sharp chips fly: wear eye protection.' }],
    stockForms: [{ kind: 'sheet', label: 'Plate', sizes: [3.175, 6.35, 9.525, 12.7] }, { kind: 'bar', label: 'Round bar', sizes: [12.7, 25.4, 50.8] }],
    description: 'The everyday aluminium for plates, brackets and fixtures. Machines well with air and sharp tools.' }),
  M('brass', { name: 'Brass 360', family: 'brass', grade: 'C36000 free-cutting', color: [205, 172, 92], physical: { hardness: '80 HB', density: 8.5, kc: 780, mc: 0.25 },
    cutting: [carbide([100, 250], [[1, 0.008], [3.175, 0.025], [6.35, 0.045], [12.7, 0.07]], { hobby: 0.25, medium: 0.5, rigid: 1.0 })],
    coolant: { need: 'none', reason: 'The chips break cleanly; dry cutting is fine.' },
    behaviour: ['Free-cutting: short chips, clean edges', 'Grabs with positive-rake tools: use neutral rake'],
    safety: [{ level: 'warn', text: 'Brass 360 contains lead: use extraction and wash your hands after handling chips.' }],
    stockForms: [{ kind: 'sheet', label: 'Plate', sizes: [3.175, 6.35] }, { kind: 'bar', label: 'Round bar', sizes: [12.7, 25.4] }],
    description: 'Free-cutting brass for fittings, knobs and small precise parts.' }),
  M('acrylic', { version: 2, name: 'Cast acrylic', family: 'plastic', grade: 'PMMA, cast', color: [178, 210, 228], physical: { hardness: 'M95 Rockwell', density: 1.19, kc: 110, mc: 0.3 },
    cutting: [carbide([150, 500], [[1, 0.02], [3.175, 0.06], [6.35, 0.11], [12.7, 0.18]], { hobby: 0.5, medium: 1.0, rigid: 1.5 })],
    coolant: { need: 'recommended', reason: 'An air blast clears the chips so they do not re-weld behind the cut.' },
    behaviour: ['Melts if the tool rubs: keep the chips thick and never dwell', 'Single-flute O-flute tools give the cleanest edge', 'Cast cuts better than extruded'],
    stockForms: [{ kind: 'sheet', label: 'Sheet', sizes: [3, 4.5, 6, 10] }],
    description: 'Clear or coloured sheet for panels, covers and signs.' }),
  M('acrylic-ext', { name: 'Extruded acrylic', family: 'plastic', grade: 'PMMA, extruded', color: [184, 214, 230], physical: { hardness: 'M90 Rockwell', density: 1.19, kc: 100, mc: 0.3 },
    cutting: [carbide([150, 400], [[1, 0.02], [3.175, 0.055], [6.35, 0.1], [12.7, 0.16]], { hobby: 0.5, medium: 0.8, rigid: 1.2 })],
    coolant: { need: 'recommended', reason: 'Melts at a lower temperature than cast: an air blast keeps it from gumming.' },
    behaviour: ['Gums up sooner than cast acrylic', 'Keep the feed high and the spindle lower'],
    stockForms: [{ kind: 'sheet', label: 'Sheet', sizes: [2, 3, 5] }],
    description: 'Cheaper acrylic sheet. It melts sooner than cast.' }),
  M('hdpe', { name: 'HDPE', family: 'plastic', grade: 'High-density polyethylene', color: [232, 232, 226], physical: { hardness: 'D65 Shore', density: 0.95, kc: 50, mc: 0.3 },
    cutting: [carbide([200, 600], [[1, 0.025], [3.175, 0.08], [6.35, 0.15], [12.7, 0.25]], { hobby: 0.75, medium: 1.25, rigid: 2 })],
    coolant: { need: 'recommended', reason: 'Air keeps the stringy chips out of the cut.' },
    behaviour: ['Stringy chips that wrap the tool', 'Soft: clamp gently, it springs back'],
    stockForms: [{ kind: 'sheet', label: 'Sheet', sizes: [6.35, 12.7, 19] }],
    description: 'Tough, slippery plastic for cutting boards, jigs and wear strips.' }),
  M('pom', { name: 'POM (Delrin)', family: 'plastic', grade: 'Acetal homopolymer', color: [236, 234, 226], physical: { hardness: 'M94 Rockwell', density: 1.41, kc: 90, mc: 0.3 },
    cutting: [carbide([150, 500], [[1, 0.02], [3.175, 0.07], [6.35, 0.12], [12.7, 0.2]], { hobby: 0.75, medium: 1.25, rigid: 2 })],
    coolant: { need: 'none', reason: 'Machines cleanly dry.' },
    behaviour: ['The easiest plastic to machine: crisp edges, holds tolerance'],
    stockForms: [{ kind: 'sheet', label: 'Sheet', sizes: [6, 10, 12] }, { kind: 'bar', label: 'Rod', sizes: [10, 20, 30] }],
    description: 'Stiff, low-friction engineering plastic for gears, bushings and slides.' }),
  M('pc', { name: 'Polycarbonate', family: 'plastic', grade: 'PC', color: [200, 214, 222], physical: { hardness: 'M70 Rockwell', density: 1.2, kc: 120, mc: 0.3 },
    cutting: [carbide([150, 400], [[1, 0.02], [3.175, 0.05], [6.35, 0.1], [12.7, 0.15]], { hobby: 0.5, medium: 1.0, rigid: 1.5 })],
    coolant: { need: 'recommended', reason: 'Air keeps the edge from melting and clouding.' },
    behaviour: ['Tough: does not crack like acrylic, but melts readily'],
    stockForms: [{ kind: 'sheet', label: 'Sheet', sizes: [2, 3, 6] }],
    description: 'Impact-resistant clear sheet for guards and windows.' }),
  M('mdf', { name: 'MDF', family: 'wood', grade: 'Medium-density fibreboard', color: [184, 150, 112], physical: { hardness: '—', density: 0.75, kc: 40, mc: 0.3 },
    cutting: [carbide([300, 900], [[1, 0.03], [3.175, 0.08], [6.35, 0.15], [12.7, 0.25]], { hobby: 0.75, medium: 1.25, rigid: 2 })],
    coolant: { need: 'avoid', reason: 'Liquid makes MDF swell. Use dust extraction instead.' },
    behaviour: ['Uniform: no grain direction', 'Edges fuzz with dull tools'],
    safety: [{ level: 'warn', text: 'MDF dust: use dust extraction. The fine dust and its resin binder are harmful to breathe.' }],
    stockForms: [{ kind: 'sheet', label: 'Sheet', sizes: [3, 6, 12, 18] }],
    description: 'Cheap, flat sheet for spoilboards, jigs and painted parts.' }),
  M('plywood', { name: 'Birch plywood', family: 'wood', grade: 'Baltic birch, B/BB', color: [222, 196, 150], physical: { hardness: '—', density: 0.68, kc: 45, mc: 0.3 },
    cutting: [carbide([300, 900], [[1, 0.03], [3.175, 0.07], [6.35, 0.13], [12.7, 0.22]], { hobby: 0.75, medium: 1.25, rigid: 2 })],
    coolant: { need: 'avoid', reason: 'Keep it dry; extraction clears the chips.' },
    behaviour: ['Down-cut or compression tools keep the top veneer from tearing', 'Glue lines wear tools faster'],
    safety: wood(), stockForms: [{ kind: 'sheet', label: 'Sheet', sizes: [3, 6, 12, 18] }],
    description: 'Stable, strong sheet for boxes, jigs and furniture parts.' }),
  M('maple', { name: 'Hard maple', family: 'wood', grade: 'Acer saccharum', color: [226, 200, 152], physical: { hardness: '6.4 kN Janka', density: 0.71, kc: 60, mc: 0.3 },
    cutting: [carbide([250, 700], [[1, 0.02], [3.175, 0.05], [6.35, 0.1], [12.7, 0.18]], { hobby: 0.5, medium: 1.0, rigid: 1.5 })],
    coolant: { need: 'avoid', reason: 'Keep it dry; extraction clears the chips.' },
    behaviour: ['Burns if the tool dwells or rubs', 'Climb cut against the grain to avoid tear-out'],
    safety: wood(), stockForms: [{ kind: 'sheet', label: 'Board', sizes: [12, 19, 25] }],
    description: 'Hard, pale hardwood for boards, handles and fine parts.' }),
  M('walnut', { name: 'Black walnut', family: 'wood', grade: 'Juglans nigra', color: [122, 92, 70], physical: { hardness: '4.5 kN Janka', density: 0.61, kc: 55, mc: 0.3 },
    cutting: [carbide([250, 700], [[1, 0.022], [3.175, 0.055], [6.35, 0.11], [12.7, 0.19]], { hobby: 0.5, medium: 1.0, rigid: 1.5 })],
    coolant: { need: 'avoid', reason: 'Keep it dry; extraction clears the chips.' },
    behaviour: ['Carves cleanly; good for V-carving and detail'],
    safety: wood([{ level: 'warn', text: 'Walnut dust can cause allergic reactions: a dust mask as well as extraction.' }]),
    stockForms: [{ kind: 'sheet', label: 'Board', sizes: [12, 19, 25] }],
    description: 'Dark hardwood for signs, inlays and boxes.' }),
  M('pine', { name: 'Pine', family: 'wood', grade: 'Softwood, kiln dried', color: [230, 206, 160], physical: { hardness: '1.7 kN Janka', density: 0.45, kc: 30, mc: 0.3 },
    cutting: [carbide([300, 900], [[1, 0.03], [3.175, 0.08], [6.35, 0.15], [12.7, 0.25]], { hobby: 1.0, medium: 1.5, rigid: 2 })],
    coolant: { need: 'avoid', reason: 'Keep it dry; extraction clears the chips.' },
    behaviour: ['Soft: tears out across the grain', 'Resin pockets gum up tools'],
    safety: wood(), stockForms: [{ kind: 'sheet', label: 'Board', sizes: [12, 19, 38] }],
    description: 'Soft, cheap wood for test cuts and rough parts.' }),
  M('cfrp', { name: 'Carbon fibre sheet', family: 'composite', grade: 'CFRP, woven', color: [62, 66, 72], physical: { hardness: '—', density: 1.55, kc: 150, mc: 0.3 },
    cutting: [carbide([100, 300], [[1, 0.01], [3.175, 0.03], [6.35, 0.05], [12.7, 0.08]], { hobby: 0.25, medium: 0.5, rigid: 1.0 })],
    coolant: { need: 'avoid', reason: 'Extraction, not mist: mist turns the dust into paste.' },
    behaviour: ['Abrasive: wears ordinary carbide quickly; diamond-coated or burr tools last longer', 'Compression tools keep the top and bottom layers from fraying'],
    safety: [{ level: 'danger', text: 'Carbon fibre dust is hazardous: use dust extraction and a respirator. The dust conducts electricity: keep it away from electronics.' }],
    stockForms: [{ kind: 'sheet', label: 'Sheet', sizes: [1, 2, 3] }],
    description: 'Stiff, light sheet for frames and drone parts.' }),
  M('g10', { name: 'G10 / FR4', family: 'composite', grade: 'Glass-epoxy laminate', color: [168, 178, 112], physical: { hardness: 'M110 Rockwell', density: 1.85, kc: 200, mc: 0.3 },
    cutting: [carbide([100, 250], [[1, 0.008], [3.175, 0.025], [6.35, 0.04], [12.7, 0.06]], { hobby: 0.2, medium: 0.4, rigid: 0.8 })],
    coolant: { need: 'avoid', reason: 'Extraction, not mist.' },
    behaviour: ['Very abrasive: tools dull fast', 'Edges fray with dull tools'],
    safety: [{ level: 'danger', text: 'G10 and FR4 dust contains glass fibre: use dust extraction and a respirator.' }],
    stockForms: [{ kind: 'sheet', label: 'Sheet', sizes: [0.8, 1.6, 3.2] }],
    description: 'Strong, insulating laminate for panels and fixtures.' }),
  M('pcb', { name: 'PCB blank (FR4, copper clad)', family: 'pcb', grade: '1 oz copper, one side', color: [196, 140, 82], physical: { hardness: '—', density: 1.85, kc: 200, mc: 0.3 },
    cutting: [carbide([100, 300], [[0.2, 0.002], [1, 0.01], [3.175, 0.03]], { hobby: 0.1, medium: 0.2, rigid: 0.4 })],
    coolant: { need: 'avoid', reason: 'Extraction, not mist.' },
    behaviour: ['Level the board first: copper is only 35 µm thick', 'Engrave isolation with a 30° V-bit or a 0.2 mm end mill'],
    safety: [{ level: 'danger', text: 'FR4 dust contains glass fibre: use dust extraction and a respirator.' }],
    stockForms: [{ kind: 'sheet', label: 'Board', sizes: [0.8, 1.6] }],
    description: 'Copper-clad boards for isolation-milled circuits.' }),
  M('foam', { name: 'HDU foam', family: 'foam', grade: 'High-density urethane, 240 kg/m³', color: [214, 196, 160], physical: { hardness: '—', density: 0.24, kc: 5, mc: 0.3 },
    cutting: [carbide([200, 1000], [[1, 0.05], [3.175, 0.15], [6.35, 0.3], [12.7, 0.5]], { hobby: 2, medium: 3, rigid: 4 })],
    coolant: { need: 'none', reason: 'Dry; extraction for the dust.' },
    behaviour: ['Very easy to cut: the machine, not the tool, sets the speed'],
    safety: [{ level: 'warn', text: 'Foam dust: use dust extraction.' }],
    stockForms: [{ kind: 'sheet', label: 'Block', sizes: [25, 50] }],
    description: 'Carving foam for signs, models and moulds.' }),
  M('pvc', { name: 'PVC', family: 'plastic', grade: 'Polyvinyl chloride', color: [214, 218, 222], physical: { hardness: '—', density: 1.38, kc: 0, mc: 0 },
    doNotMachine: true, coolant: { need: 'none', reason: 'Not applicable.' },
    safety: [{ level: 'danger', text: 'Do not machine PVC: it releases corrosive, toxic gas that harms you and rusts your machine.' }],
    description: 'Listed so you can see why it is not offered. Run does not suggest feeds for it and the stock picker will not choose it.' }),
];
export const notOffered = 'Magnesium is not offered: its fine chips catch fire and burn too hot for water to put out.';

// Mine: the user's own records. A fork inherits from its built-in until a
// value is changed (`overrides`), and records which version it came from.
export const myMaterials = [
  { id: 'my-mdf', source: 'mine', forkOf: { id: 'mdf', version: 1 }, overrides: { name: 'Shop MDF (timber yard)', notes: 'This batch is softer than branded MDF: +10 % feed is fine.', purchase: [{ kind: 'link', vendor: 'Timber yard', url: 'https://timberyard.example/mdf-18', price: 38, currency: 'USD', boughtAt: '2026-09-20' }] } },
  { id: 'my-birch12', source: 'mine', forkOf: { id: 'plywood', version: 1 }, overrides: { name: 'Baltic birch 12 mm', grade: '12 mm, 9-ply', stockForms: [{ kind: 'sheet', label: 'Sheet', sizes: [12] }], notes: 'Measures 11.7 mm. Down-cut for the top pass.' } },
];

// Tool library (§2). cuttingData sources: manufacturer | synthetos | user | ai.
export const tools = [
  { id: 'T1', number: 1, type: 'flat', name: '3.175 mm 2-flute up-cut', diameter: 3.175, flutes: 2, fluteLength: 12, overall: 38, shank: 3.175, stickout: 20, maxRpm: 30000,
    material: 'Carbide', coating: 'Uncoated', manufacturer: 'Northline Tooling', partNumber: 'NL-2F-0125-UC', synced: true,
    description: 'General-purpose 2-flute up-cut end mill for aluminium, plastics and wood.',
    notes: 'Chatters above 24 000 rpm in maple. Keep the stickout at 20 mm.',
    datasheetUrl: 'https://northline.example/datasheets/nl-2f-0125-uc.pdf',
    purchase: [
      { kind: 'store', vendor: 'Synthetos', url: storeUrl('SYN-EM-3175-2F'), sku: 'SYN-EM-3175-2F', price: 13.5, currency: 'USD', boughtAt: '2026-08-02' },
      { kind: 'link', vendor: 'Northline Tooling', url: 'https://northline.example/nl-2f-0125-uc', sku: 'NL-2F-0125-UC', price: 12.4, currency: 'USD', boughtAt: '2026-03-14' },
    ],
    cuttingData: [
      { materialRef: 'al6061', vc: 220, fz: 0.025, ap: 0.6, ae: 1.3, coolant: 'air', source: 'manufacturer', note: 'Datasheet table: slotting and adaptive' },
      { materialRef: 'acrylic', vc: 200, fz: 0.05, ap: 1.5, ae: 1.6, coolant: 'air', source: 'user', note: 'Melted at 0.03; keep it above 0.045' },
      { materialRef: 'mdf', vc: 300, fz: 0.08, ap: 3, ae: 1.6, coolant: 'none', source: 'synthetos', note: 'Measured on a belt-driven router' },
      { materialRef: 'maple', vc: 240, fz: 0.045, ap: 1.5, ae: 1.2, coolant: 'none', source: 'ai', note: 'AI assistant (preview), checked by the rules envelope' },
    ],
    life: { minutes: { al6061: 146, acrylic: 41, mdf: 92 }, expected: { al6061: 180, acrylic: 400, mdf: 900 } } },
  { id: 'T2', number: 2, type: 'flat', name: '6 mm 3-flute ZrN', diameter: 6, flutes: 3, fluteLength: 18, overall: 50, shank: 6, stickout: 26, maxRpm: 24000,
    material: 'Carbide', coating: 'ZrN', manufacturer: 'Northline Tooling', partNumber: 'NL-3F-6-ZRN', synced: true,
    description: 'Stiff 3-flute for aluminium roughing and finishing walls.', notes: '',
    datasheetUrl: 'https://northline.example/datasheets/nl-3f-6-zrn.pdf',
    purchase: [{ kind: 'link', vendor: 'Northline Tooling', url: 'https://northline.example/nl-3f-6-zrn', sku: 'NL-3F-6-ZRN', price: 27, currency: 'USD', boughtAt: '2026-05-30' }],
    cuttingData: [{ materialRef: 'al6061', vc: 250, fz: 0.04, ap: 1.5, ae: 1.5, coolant: 'mist', source: 'manufacturer', note: 'Datasheet table' }],
    life: { minutes: { al6061: 38 }, expected: { al6061: 300 } } },
  { id: 'T3', number: 3, type: 'ball', name: '3.175 mm ball nose', diameter: 3.175, flutes: 2, fluteLength: 12, overall: 38, shank: 3.175, stickout: 18, maxRpm: 30000,
    material: 'Carbide', coating: 'AlTiN', manufacturer: 'Bitwise Cutters', partNumber: 'BW-BN-0125', synced: true,
    description: 'Ball nose for 3D surfacing and fillets.', notes: 'Use 10 % stepover for a smooth finish in walnut.',
    datasheetUrl: '', purchase: [{ kind: 'link', vendor: 'Bitwise Cutters', url: 'https://bitwise.example/bn-0125', price: 15, currency: 'USD', boughtAt: '2025-12-01' }],
    cuttingData: [{ materialRef: 'walnut', vc: 250, fz: 0.04, ap: 1, ae: 0.3, coolant: 'none', source: 'user', note: '' }],
    life: { minutes: { walnut: 210, maple: 60 }, expected: { walnut: 900, maple: 700 } } },
  { id: 'T4', number: 4, type: 'vbit', name: '90° V-bit', diameter: 12.7, flutes: 2, fluteLength: 6.4, overall: 45, shank: 6.35, stickout: 22, angle: 90, maxRpm: 24000,
    material: 'Carbide', coating: 'Uncoated', manufacturer: 'Synthetos', partNumber: 'SYN-VB-90-127', synced: true,
    description: '90° engraving and V-carving bit, 12.7 mm wide.', notes: '',
    datasheetUrl: '', purchase: [{ kind: 'store', vendor: 'Synthetos', url: storeUrl('SYN-VB-90-127'), sku: 'SYN-VB-90-127', price: 18, currency: 'USD', boughtAt: '2026-08-02' }],
    cuttingData: [{ materialRef: 'al6061', vc: 200, fz: 0.017, ap: 1.5, ae: 3, coolant: 'air', source: 'synthetos', note: 'Engraving, 1.5 mm maximum depth' }],
    life: { minutes: { al6061: 12, walnut: 95 }, expected: { al6061: 200, walnut: 1200 } } },
  { id: 'T5', number: 5, type: 'drill', name: '5 mm carbide drill', diameter: 5, flutes: 2, fluteLength: 28, overall: 62, shank: 5, stickout: 34, angle: 140, maxRpm: 20000,
    material: 'Carbide', coating: 'TiAlN', manufacturer: 'Bitwise Cutters', partNumber: 'BW-DR-5-C140', synced: true,
    description: 'Stub-length carbide drill with a 140° point.', notes: 'Peck: it packs with aluminium chips past 6 mm.',
    datasheetUrl: 'https://bitwise.example/datasheets/dr-5-c140.pdf', purchase: [{ kind: 'link', vendor: 'Bitwise Cutters', url: 'https://bitwise.example/dr-5-c140', price: 9.8, currency: 'USD', boughtAt: '2026-01-11' }],
    cuttingData: [{ materialRef: 'al6061', vc: 157, fz: 0.045, ap: 1, ae: 5, coolant: 'air', source: 'manufacturer', note: 'Pecking 1×D' }],
    life: { minutes: { al6061: 9 }, expected: { al6061: 240 } } },
  { id: 'T6', number: 6, type: 'oflute', name: '6.35 mm O-flute', diameter: 6.35, flutes: 1, fluteLength: 22, overall: 63, shank: 6.35, stickout: 28, maxRpm: 24000,
    material: 'Carbide', coating: 'Uncoated', manufacturer: 'Synthetos', partNumber: 'SYN-OF-6350', synced: false,
    description: 'Single-flute O-flute for plastics: big chips, clean edges.', notes: '',
    datasheetUrl: '', purchase: [{ kind: 'store', vendor: 'Synthetos', url: storeUrl('SYN-OF-6350'), sku: 'SYN-OF-6350', price: 19, currency: 'USD', boughtAt: '2026-10-01' }],
    cuttingData: [{ materialRef: 'acrylic', vc: 300, fz: 0.11, ap: 3, ae: 3, coolant: 'air', source: 'synthetos', note: '' }],
    life: { minutes: {}, expected: { acrylic: 600 } } },
];
export const toolKinds = { flat: 'End mill', ball: 'Ball nose', bull: 'Bull nose', vbit: 'V-bit', drill: 'Drill', oflute: 'O-flute', chamfer: 'Chamfer', engraver: 'Engraver', surfacing: 'Surfacing', thread: 'Thread mill' };
export const toolById = (id) => tools.find((t) => t.id === id);
export const sourceLabels = { manufacturer: 'Manufacturer', synthetos: 'Synthetos', user: 'Mine', ai: 'AI' };

// Tool wear: the share of expected life used, summed across materials.
export function toolWear(tool) {
  const m = tool.life?.minutes ?? {}, e = tool.life?.expected ?? {};
  const parts = Object.entries(m).map(([mat, min]) => ({ mat, min, share: e[mat] ? min / e[mat] : 0 }));
  const used = parts.reduce((a, p) => a + p.share, 0);
  return { parts, used, minutes: parts.reduce((a, p) => a + p.min, 0), dull: used >= 0.9 };
}

// ---------- Resolver ----------
const byId = Object.fromEntries(builtinMaterials.map((m) => [m.id, m]));
export const storeMaterialLinks = {}; // filled by store.mjs: sku -> product
export function material(id) {
  if (byId[id]) return byId[id];
  const mine = myMaterials.find((m) => m.id === id);
  if (mine) {
    const base = byId[mine.forkOf?.id] ?? {};
    return { ...base, ...mine.overrides, id: mine.id, source: 'mine', forkOf: mine.forkOf, version: mine.version ?? 1, safety: [...(base.safety ?? []), ...(mine.overrides.safety ?? [])], purchase: mine.overrides.purchase ?? [], notes: mine.overrides.notes ?? '', overrides: mine.overrides };
  }
  const product = storeMaterialLinks[id];
  if (product) {
    const base = byId[product.spec.materialRef] ?? {};
    return { ...base, id, source: 'store', name: product.title, product, linked: { id: base.id, version: base.version }, purchase: [{ kind: 'store', vendor: 'Synthetos', url: storeUrl(product.sku), sku: product.sku, price: product.price, currency: 'USD' }], notes: '' };
  }
  return byId.al6061;
}
export function allMaterials() { return [...builtinMaterials.map((m) => m.id), ...myMaterials.map((m) => m.id), ...Object.keys(storeMaterialLinks)].map(material); }
export function forkMaterial(id) {
  const base = byId[id]; const n = myMaterials.filter((m) => m.forkOf?.id === id).length;
  const rec = { id: `my-${id}-${n + 1}`, source: 'mine', forkOf: { id, version: base.version }, overrides: { name: `My ${base.name.charAt(0).toLowerCase()}${base.name.slice(1)}` } };
  myMaterials.push(rec); return rec;
}
// The carbide cutting row for a material (or the first row).
export const cuttingRow = (mat, toolMaterial = 'carbide') => mat.cutting?.find((c) => c.toolMaterial === toolMaterial.toLowerCase().replace('hss-co', 'hss')) ?? mat.cutting?.[0] ?? null;
export function fzAt(row, d) {
  const pts = row.fz; if (!pts?.length) return 0;
  if (d <= pts[0][0]) return pts[0][1] * d / pts[0][0];
  for (let i = 1; i < pts.length; i++) if (d <= pts[i][0]) { const [d0, f0] = pts[i - 1], [d1, f1] = pts[i]; return f0 + (f1 - f0) * (d - d0) / (d1 - d0); }
  const [d0, f0] = pts.at(-2), [d1, f1] = pts.at(-1); return f1 + (f1 - f0) / (d1 - d0) * (d - d1) * 0.5;
}
export const money = (n, cur = 'USD') => (n == null ? '—' : `${cur === 'USD' ? '$' : `${cur} `}${n.toFixed(2)}`);
export const shortDate = (iso) => { if (!iso) return '—'; const d = new Date(`${iso}T12:00:00Z`); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
