/**
 * Runtime validation of library records (MACHINING_ASSISTANT §2, §3, §4, §8).
 *
 * `read*` takes any value (from storage, an import, the cloud, a form) and
 * returns either a frozen, detached record or every issue found, never an
 * exception. The shape is checked by the JSON Schemas in schemas.ts through
 * the repository's own validator; the rules a JSON Schema cannot state are
 * checked here, after the shape is known to be right:
 *
 * - every purchase and datasheet link passes `checkExternalUrl` (§8);
 * - a sourced number has exactly one of `source` and `placeholder` (§1.4);
 * - per-type tool geometry (a bull-nose has a corner radius, a V-bit an
 *   angle, a drill a point angle; no type carries another type's fields);
 * - ranges are ordered, a chipload curve rises in diameter, stock forms and
 *   stock shapes carry the size their kind needs;
 * - a material with a `do-not-machine` safety note has no cutting data;
 * - calendar dates exist; a price names its currency.
 */
import { validateSchema, type Schema, type SchemaError } from '@synthetos/schema/json-schema';
import { frozenCopy } from './freeze.ts';
import {
  FIXTURE_SCHEMA,
  MATERIAL_SCHEMA,
  PURCHASE_LINK_SCHEMA,
  STOCK_SCHEMA,
  STORE_PRODUCT_SCHEMA,
  TOOL_SCHEMA,
} from './schemas.ts';
import type { Sourced } from './sourced.ts';
import type { Fixture, Material, PurchaseLink, Stock, StoreProduct, Tool, ToolGeometry, ToolType } from './types.ts';
import { checkExternalUrl } from './url.ts';

export type LibraryIssue = SchemaError;

export type LibraryResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly LibraryIssue[] };

type TypeSpecificField = 'cornerRadius' | 'vAngle' | 'tipWidth' | 'pointAngle';

/** Which type-specific geometry each tool type requires and allows (any other is refused). */
export const TOOL_TYPE_GEOMETRY: Readonly<Record<ToolType, { readonly required: readonly TypeSpecificField[]; readonly optional: readonly TypeSpecificField[] }>> =
  Object.freeze({
    flat: { required: [], optional: [] },
    ball: { required: [], optional: [] },
    'bull-nose': { required: ['cornerRadius'], optional: [] },
    'v-bit': { required: ['vAngle'], optional: ['tipWidth'] },
    chamfer: { required: ['vAngle'], optional: ['tipWidth'] },
    drill: { required: ['pointAngle'], optional: [] },
    engraver: { required: ['vAngle'], optional: ['tipWidth'] },
    'o-flute': { required: [], optional: [] },
    surfacing: { required: [], optional: [] },
    'thread-mill': { required: [], optional: [] },
  });
const TYPE_SPECIFIC_FIELDS: readonly TypeSpecificField[] = ['cornerRadius', 'vAngle', 'tipWidth', 'pointAngle'];

type Add = (path: string, message: string) => void;

/** A chipload value as the schema admits it, before the per-kind rule below narrows it. */
interface LooseChipload {
  readonly kind: 'factor' | 'curve';
  readonly min?: number;
  readonly max?: number;
  readonly points?: readonly { readonly d: number; readonly min: number; readonly max: number }[];
}

function read<T>(schema: Schema, value: unknown, semantic: (v: T, add: Add) => void): LibraryResult<T> {
  const issues: LibraryIssue[] = validateSchema(schema, value);
  if (issues.length === 0) semantic(value as T, (path, message) => issues.push({ path, message }));
  if (issues.length > 0) return Object.freeze({ ok: false, issues: Object.freeze(issues.map((i) => Object.freeze({ ...i }))) });
  return Object.freeze({ ok: true, value: frozenCopy(value as T) });
}

function checkUrl(url: string, path: string, add: Add): void {
  const checked = checkExternalUrl(url);
  if (!checked.ok) add(path, checked.message);
}

function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function checkLink(link: PurchaseLink, path: string, add: Add): void {
  checkUrl(link.url, `${path}/url`, add);
  if (link.price !== undefined && link.currency === undefined) add(`${path}/currency`, 'a price needs its currency');
  if (link.boughtAt !== undefined && !isRealDate(link.boughtAt)) add(`${path}/boughtAt`, `${link.boughtAt} is not a calendar date`);
}

function checkPurchase(links: readonly PurchaseLink[], at: string, add: Add): void {
  links.forEach((link, i) => checkLink(link, `${at}/${i}`, add));
}

function checkSourced(v: Sourced<unknown> | undefined, path: string, add: Add): void {
  if (v === undefined) return;
  const cited = 'source' in v;
  const placeholder = 'placeholder' in v;
  if (cited === placeholder) add(path, 'a value names its source or is marked as a placeholder, exactly one of the two');
  if (cited && 'note' in v) add(`${path}/note`, 'only a placeholder carries a note');
}

function toolSemantics(t: Tool, add: Add): void {
  const g: ToolGeometry = t.geometry;
  const spec = TOOL_TYPE_GEOMETRY[t.type];
  for (const field of TYPE_SPECIFIC_FIELDS) {
    const present = g[field] !== undefined;
    if (spec.required.includes(field) && !present) add('/geometry', `a ${t.type} tool needs ${field}`);
    if (!spec.required.includes(field) && !spec.optional.includes(field) && present) add(`/geometry/${field}`, `a ${t.type} tool has no ${field}`);
  }
  if (g.cornerRadius !== undefined && g.cornerRadius > g.diameter / 2) add('/geometry/cornerRadius', 'the corner radius is larger than half the diameter');
  if (g.vAngle !== undefined && g.vAngle >= 180) add('/geometry/vAngle', 'the included angle must be below 180°');
  if (g.pointAngle !== undefined && g.pointAngle >= 180) add('/geometry/pointAngle', 'the point angle must be below 180°');
  if (g.tipWidth !== undefined && g.tipWidth >= g.diameter) add('/geometry/tipWidth', 'the tip is wider than the tool');
  if (g.fluteLength > g.overallLength) add('/geometry/fluteLength', 'the flutes are longer than the tool');
  if (g.stickout !== undefined && g.stickout > g.overallLength) add('/geometry/stickout', 'the stickout is longer than the tool');
  checkPurchase(t.purchase, '/purchase', add);
  if (t.datasheetUrl !== undefined) checkUrl(t.datasheetUrl, '/datasheetUrl', add);
  t.cuttingData.forEach((c, i) => {
    if (c.ae > g.diameter) add(`/cuttingData/${i}/ae`, 'the radial engagement is larger than the tool diameter');
  });
  const seen = new Set<string>();
  t.life.byMaterial.forEach((m, i) => {
    if (seen.has(m.materialRef.id)) add(`/life/byMaterial/${i}`, `material ${m.materialRef.id} is listed twice`);
    seen.add(m.materialRef.id);
  });
}

function materialSemantics(m: Material, add: Add): void {
  checkSourced(m.physical.hardness, '/physical/hardness', add);
  checkSourced(m.physical.density, '/physical/density', add);
  checkSourced(m.physical.kc, '/physical/kc', add);
  const toolMaterials = new Set<string>();
  m.cutting.forEach((c, i) => {
    const at = `/cutting/${i}`;
    if (toolMaterials.has(c.toolMaterial)) add(`${at}/toolMaterial`, `${c.toolMaterial} already has cutting data`);
    toolMaterials.add(c.toolMaterial);
    checkSourced(c.vc, `${at}/vc`, add);
    checkSourced(c.chipload, `${at}/chipload`, add);
    checkSourced(c.engagement, `${at}/engagement`, add);
    if (c.vc.value.min > c.vc.value.max) add(`${at}/vc/value`, 'the surface speed range is reversed');
    const fz = c.chipload.value as LooseChipload;
    if (fz.kind === 'factor') {
      if (fz.min === undefined || fz.max === undefined || fz.points !== undefined) add(`${at}/chipload/value`, 'a chipload factor has min and max and no points');
      else if (fz.min > fz.max) add(`${at}/chipload/value`, 'the chipload factor range is reversed');
    } else if (fz.points === undefined || fz.points.length < 2 || fz.min !== undefined || fz.max !== undefined) {
      add(`${at}/chipload/value`, 'a chipload curve has two or more points and no min or max');
    } else {
      const points = fz.points;
      points.forEach((p, j) => {
        if (p.min > p.max) add(`${at}/chipload/value/points/${j}`, 'the chipload range is reversed');
        if (j > 0 && p.d <= (points[j - 1] as { readonly d: number }).d) add(`${at}/chipload/value/points/${j}`, 'curve points must rise in diameter');
      });
    }
  });
  if (m.cutting.length > 0 && m.safety.some((s) => s.severity === 'do-not-machine')) {
    add('/cutting', 'a material marked do-not-machine has no cutting data');
  }
  m.stockForms.forEach((f, i) => {
    const wanted = f.kind === 'sheet' ? 'thickness' : 'diameter';
    const other = f.kind === 'sheet' ? 'diameter' : 'thickness';
    if (!(wanted in f) || other in f) add(`/stockForms/${i}`, `a ${f.kind} has a ${wanted} and no ${other}`);
  });
  checkPurchase(m.purchase, '/purchase', add);
}

export function readPurchaseLink(value: unknown): LibraryResult<PurchaseLink> {
  return read<PurchaseLink>(PURCHASE_LINK_SCHEMA, value, (link, add) => checkLink(link, '', add));
}

export function readTool(value: unknown): LibraryResult<Tool> {
  return read<Tool>(TOOL_SCHEMA, value, toolSemantics);
}

export function readMaterial(value: unknown): LibraryResult<Material> {
  return read<Material>(MATERIAL_SCHEMA, value, materialSemantics);
}

export function readStock(value: unknown): LibraryResult<Stock> {
  return read<Stock>(STOCK_SCHEMA, value, (s, add) => {
    if ((s.shape === 'round') !== (s.diameter !== undefined)) add('/diameter', 'round stock, and only round stock, has a diameter');
  });
}

export function readFixture(value: unknown): LibraryResult<Fixture> {
  return read<Fixture>(FIXTURE_SCHEMA, value, (f, add) => {
    f.holes.forEach((h, i) => {
      if (h[2] <= 0) add(`/holes/${i}/2`, 'a hole radius must be greater than 0');
    });
  });
}

export function readStoreProduct(value: unknown): LibraryResult<StoreProduct> {
  return read<StoreProduct>(STORE_PRODUCT_SCHEMA, value, () => undefined);
}
