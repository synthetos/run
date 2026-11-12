/**
 * Library record types (MACHINING_ASSISTANT §2, §3, §4; WORKSPACE_FEATURES
 * "Workholding and bed", "Stock and material").
 *
 * Lengths are millimetres, feeds mm/min, speeds rpm, surface speeds m/min,
 * angles degrees, masses g/cm³, specific cutting force N/mm². Identifiers are
 * stable ids, never display names.
 *
 * Tools and materials are versioned (`id`, `version`): a stock or a cutting
 * data entry refers to a material by both, so a job records exactly what it
 * was cut from. A record forked from another carries `forkOf` (fork.ts).
 */
import type { Sourced } from './sourced.ts';

/** A reference to one version of a versioned record. */
export interface RecordRef {
  readonly id: string;
  /** 1, 2, 3, ...: each saved change makes a new version. */
  readonly version: number;
}

export type MaterialRef = RecordRef;

/** The record a fork was made from, at the version it was made from. */
export type ForkOf = RecordRef;

export type Coolant = 'none' | 'air' | 'mist' | 'flood';

/** Machine frame classes (§5.1): from the machine preset, adjustable by the user. */
export type FrameClass = 'hobby' | 'medium' | 'rigid';
export const FRAME_CLASSES: readonly FrameClass[] = Object.freeze(['hobby', 'medium', 'rigid']);

// --- Purchase links (§2 purchase[], §3 purchase[]) -------------------------

export interface PurchaseLink {
  readonly vendor: string;
  /** An absolute http(s) link, checked by `checkExternalUrl` (§8). Never fetched. */
  readonly url: string;
  readonly sku?: string;
  readonly price?: number;
  /** ISO 4217 code, `USD`. */
  readonly currency?: string;
  /** ISO 8601 date, `2026-11-02`. */
  readonly boughtAt?: string;
  readonly kind: 'store' | 'link';
}

// --- Tools (§2) -------------------------------------------------------------

export const TOOL_TYPES = Object.freeze([
  'flat',
  'ball',
  'bull-nose',
  'v-bit',
  'chamfer',
  'drill',
  'engraver',
  'o-flute',
  'surfacing',
  'thread-mill',
] as const);
export type ToolType = (typeof TOOL_TYPES)[number];

export const TOOL_MATERIALS = Object.freeze(['carbide', 'hss', 'cobalt'] as const);
export type ToolMaterial = (typeof TOOL_MATERIALS)[number];

export const COATINGS = Object.freeze(['uncoated', 'TiN', 'TiCN', 'ZrN', 'TiAlN', 'AlTiN', 'DLC', 'diamond'] as const);
export type Coating = (typeof COATINGS)[number];

export interface ToolGeometry {
  /** Cutting diameter. */
  readonly diameter: number;
  /** Shank diameter. */
  readonly shank: number;
  readonly flutes: number;
  readonly fluteLength: number;
  readonly overallLength: number;
  /** Set per holder: the length out of the collet. */
  readonly stickout?: number;
  /** Helix angle. */
  readonly helix?: number;
  /** Bull-nose corner radius. */
  readonly cornerRadius?: number;
  /** Included angle of a V-bit, chamfer mill or engraver. */
  readonly vAngle?: number;
  /** Flat tip width of a V-bit or engraver. */
  readonly tipWidth?: number;
  /** Drill point angle. */
  readonly pointAngle?: number;
}

export type CuttingDataSource = 'manufacturer' | 'synthetos' | 'user' | 'ai';

/** One cutting data entry for this tool in one material. Manufacturer data beats generic data. */
export interface ToolCuttingData {
  readonly materialRef: MaterialRef;
  /** Surface speed, m/min. */
  readonly vc?: number;
  /** Chipload, mm per tooth. */
  readonly fz: number;
  /** Axial depth of cut. */
  readonly ap?: number;
  /** Radial engagement (stepover). */
  readonly ae?: number;
  readonly coolant?: Coolant;
  readonly source: CuttingDataSource;
  readonly note: string;
  /** Manufacturer category label, without implying a match to a particular alloy or grade. */
  readonly materialName?: string;
  readonly sourceUrl?: string;
  /** One-based PDF page (not the printed page number). */
  readonly sourcePage?: number;
  /** Unsourced demonstration data, never a manufacturer claim. */
  readonly placeholder?: true;
}

/** Minutes cut, broken down by material, from jobs run (P3). */
export interface ToolLife {
  readonly minutes: number;
  readonly byMaterial: readonly { readonly materialRef: MaterialRef; readonly minutes: number }[];
}

/**
 * Unused. TinyG has no firmware tool table: tools live in software, in this
 * library, and the UI shows none. Kept only because g2core may get a firmware
 * tool table later.
 */
export interface FirmwareSlot {
  /** T number. */
  readonly t: number;
  readonly lengthOffset: number;
}

export interface Tool {
  readonly id: string;
  readonly version: number;
  /** The user's own name ("¼ in 2-flute up-cut"). */
  readonly name: string;
  readonly type: ToolType;
  readonly geometry: ToolGeometry;
  readonly toolMaterial: ToolMaterial;
  readonly coating: Coating;
  readonly manufacturer?: string;
  readonly partNumber?: string;
  readonly description: string;
  /** The user's notes ("chatters above 18k in oak"). */
  readonly notes: string;
  readonly purchase: readonly PurchaseLink[];
  /** Link only: never fetched from the browser (§8). */
  readonly datasheetUrl?: string;
  readonly cuttingData: readonly ToolCuttingData[];
  readonly life: ToolLife;
  readonly firmwareSlot?: FirmwareSlot;
  readonly tags: readonly string[];
  /** Asset references (image upload comes later, Cloud): our own images, never hotlinked. */
  readonly images: readonly string[];
  readonly forkOf?: ForkOf;
}

// --- Materials (§3) ---------------------------------------------------------

export const MATERIAL_FAMILIES = Object.freeze(['aluminium', 'brass-copper', 'steel', 'plastic', 'wood', 'composite', 'foam', 'pcb'] as const);
export type MaterialFamily = (typeof MATERIAL_FAMILIES)[number];

export type HardnessScale = 'HB' | 'HRB' | 'HRC' | 'HRM' | 'shore-D' | 'janka-N';

export interface Hardness {
  readonly value: number;
  readonly scale: HardnessScale;
}

export interface MaterialPhysical {
  readonly hardness?: Sourced<Hardness>;
  /** g/cm³. */
  readonly density?: Sourced<number>;
  /** Specific cutting force `kc`, N/mm², for power checks. */
  readonly kc?: Sourced<number>;
}

export interface Range {
  readonly min: number;
  readonly max: number;
}

/**
 * Chipload for a tool diameter D: either a factor (fz = factor · D, as a
 * range) or a curve of ranges by diameter, interpolated between points.
 */
export type ChiploadData =
  | { readonly kind: 'factor'; readonly min: number; readonly max: number }
  | { readonly kind: 'curve'; readonly points: readonly { readonly d: number; readonly min: number; readonly max: number }[] };

/** Maximum axial (ap) and radial (ae) engagement, as multiples of the tool diameter. */
export interface EngagementLimit {
  readonly ap: number;
  readonly ae: number;
}

/** Cutting data for one tool material. */
export interface MaterialCutting {
  readonly toolMaterial: ToolMaterial;
  /** Surface speed range, m/min. */
  readonly vc: Sourced<Range>;
  readonly chipload: Sourced<ChiploadData>;
  readonly engagement: Sourced<Readonly<Record<FrameClass, EngagementLimit>>>;
}

export type CoolantNeed = 'required' | 'recommended' | 'none' | 'avoid';

export interface MaterialCoolant {
  readonly need: CoolantNeed;
  /** "aluminium welds to the flutes without air or mist". */
  readonly reason: string;
}

export type BehaviourKind = 'melts' | 'work-hardens' | 'chip-evacuation' | 'grain-direction';

export interface BehaviourNote {
  readonly kind: BehaviourKind;
  readonly text: string;
}

/**
 * Safety notes are shown wherever the material is chosen, never hidden.
 * `do-not-machine` means exactly that: a material carrying one has no
 * cutting data, and the advisor refuses it.
 */
export const SAFETY_SEVERITIES = Object.freeze(['do-not-machine', 'hazard', 'caution', 'info'] as const);
export type SafetySeverity = (typeof SAFETY_SEVERITIES)[number];

export interface SafetyNote {
  readonly severity: SafetySeverity;
  readonly text: string;
}

export type StockForm = { readonly kind: 'sheet'; readonly thickness: number } | { readonly kind: 'bar'; readonly diameter: number };

export interface Material {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly family: MaterialFamily;
  readonly grade: string;
  readonly physical: MaterialPhysical;
  readonly cutting: readonly MaterialCutting[];
  readonly coolant: MaterialCoolant;
  readonly behaviour: readonly BehaviourNote[];
  readonly safety: readonly SafetyNote[];
  /** Sheet thicknesses and bar diameters available; they feed the stock picker. */
  readonly stockForms: readonly StockForm[];
  readonly purchase: readonly PurchaseLink[];
  readonly description: string;
  readonly notes: string;
  readonly forkOf?: ForkOf;
}

// --- Stock and workholding (WORKSPACE_FEATURES; §3 "Stock references a material by id and version") --

export type StockCorner = 'front-left' | 'front-right' | 'back-left' | 'back-right' | 'center';

export interface Stock {
  readonly shape: 'block' | 'round' | 'sheet';
  readonly width: number;
  readonly depth: number;
  /** Round stock only. */
  readonly diameter?: number;
  readonly thickness: number;
  readonly materialRef: MaterialRef;
  readonly position: { readonly x: number; readonly y: number };
  readonly zero: { readonly corner: StockCorner; readonly height: 'top' | 'bottom' };
}

export interface FixtureClamp {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
}

export interface Fixture {
  readonly id: string;
  readonly name: string;
  /** The DXF or SVG file the outline came from; parsed locally, never uploaded unless the project syncs. */
  readonly source: { readonly file: string; readonly kind: 'dxf' | 'svg'; readonly hash: string };
  readonly outline: readonly (readonly [number, number])[];
  /** `[x, y, r]`. */
  readonly holes: readonly (readonly [number, number, number])[];
  readonly height: number;
  readonly position: { readonly x: number; readonly y: number };
  readonly material: string;
  readonly clamps?: readonly FixtureClamp[];
}

// --- Store (§4) -------------------------------------------------------------

export type StockState = 'in-stock' | 'low-stock' | 'out-of-stock' | 'preorder';

export interface StoreProduct {
  readonly sku: string;
  readonly title: string;
  readonly price: number;
  /** ISO 4217 code. */
  readonly currency: string;
  readonly stockState: StockState;
  /** Our own images, as relative asset paths: the CSP does not allow hotlinking. */
  readonly images: readonly string[];
  /** The versioned tool or material spec the product carries. */
  readonly spec: { readonly kind: 'tool' | 'material'; readonly id: string; readonly version: number };
}
