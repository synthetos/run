/**
 * Seed tools for the tool library, from the workspace design study
 * (docs/design/workspace-prototype/library.mjs), in the `@synthetos/library`
 * Tool shape. Cutting rows, notes and usage start empty; invented starter
 * data was removed by the owner on 2026-11-12. No purchase links are
 * seeded (the bundle carries no other origin): people add their own, checked
 * by `safeExternalLink`. `store` names a Synthetos store SKU, shown as a mock.
 *
 * Generated from the study once; edit by hand from here on.
 */
import type { Tool } from '@synthetos/library';

export interface SeedTool {
  /** The T number this tool usually goes in. */
  readonly number: number;
  /** A Synthetos store SKU (the store is a mock in this release), or null. */
  readonly store: string | null;
  readonly tool: Tool;
}

export const SEED_TOOLS: readonly SeedTool[] = [
  {"number":1,"store":null,"tool":{"id":"seed.t1","version":1,"name":"3.175 mm 2-flute up-cut","type":"flat","geometry":{"diameter":3.175,"shank":3.175,"flutes":2,"fluteLength":12,"overallLength":38,"stickout":20},"toolMaterial":"carbide","coating":"uncoated","manufacturer":"Northline Tooling","partNumber":"NL-2F-0125-UC","description":"General-purpose 2-flute up-cut end mill for aluminium, plastics and wood.","notes":"","purchase":[],"cuttingData":[],"life":{"minutes":0,"byMaterial":[]},"tags":[],"images":[]}},
  {"number":2,"store":null,"tool":{"id":"seed.t2","version":1,"name":"6 mm 3-flute ZrN","type":"flat","geometry":{"diameter":6,"shank":6,"flutes":3,"fluteLength":18,"overallLength":50,"stickout":26},"toolMaterial":"carbide","coating":"ZrN","manufacturer":"Northline Tooling","partNumber":"NL-3F-6-ZRN","description":"Stiff 3-flute for aluminium roughing and finishing walls.","notes":"","purchase":[],"cuttingData":[],"life":{"minutes":0,"byMaterial":[]},"tags":[],"images":[]}},
  {"number":3,"store":null,"tool":{"id":"seed.t3","version":1,"name":"3.175 mm ball nose","type":"ball","geometry":{"diameter":3.175,"shank":3.175,"flutes":2,"fluteLength":12,"overallLength":38,"stickout":18},"toolMaterial":"carbide","coating":"AlTiN","manufacturer":"Bitwise Cutters","partNumber":"BW-BN-0125","description":"Ball nose for 3D surfacing and fillets.","notes":"","purchase":[],"cuttingData":[],"life":{"minutes":0,"byMaterial":[]},"tags":[],"images":[]}},
  {"number":4,"store":"SYN-VB-90-127","tool":{"id":"seed.t4","version":1,"name":"90° V-bit","type":"v-bit","geometry":{"diameter":12.7,"shank":6.35,"flutes":2,"fluteLength":6.4,"overallLength":45,"stickout":22,"vAngle":90},"toolMaterial":"carbide","coating":"uncoated","manufacturer":"Synthetos","partNumber":"SYN-VB-90-127","description":"90° engraving and V-carving bit, 12.7 mm wide.","notes":"","purchase":[],"cuttingData":[],"life":{"minutes":0,"byMaterial":[]},"tags":[],"images":[]}},
  {"number":5,"store":null,"tool":{"id":"seed.t5","version":1,"name":"5 mm carbide drill","type":"drill","geometry":{"diameter":5,"shank":5,"flutes":2,"fluteLength":28,"overallLength":62,"stickout":34,"pointAngle":140},"toolMaterial":"carbide","coating":"TiAlN","manufacturer":"Bitwise Cutters","partNumber":"BW-DR-5-C140","description":"Stub-length carbide drill with a 140° point.","notes":"","purchase":[],"cuttingData":[],"life":{"minutes":0,"byMaterial":[]},"tags":[],"images":[]}},
  {"number":6,"store":"SYN-OF-6350","tool":{"id":"seed.t6","version":1,"name":"6.35 mm O-flute","type":"o-flute","geometry":{"diameter":6.35,"shank":6.35,"flutes":1,"fluteLength":22,"overallLength":63,"stickout":28},"toolMaterial":"carbide","coating":"uncoated","manufacturer":"Synthetos","partNumber":"SYN-OF-6350","description":"Single-flute O-flute for plastics: big chips, clean edges.","notes":"","purchase":[],"cuttingData":[],"life":{"minutes":0,"byMaterial":[]},"tags":[],"images":[]}},
];
