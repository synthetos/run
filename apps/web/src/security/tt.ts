/**
 * The two Trusted Types policies of run.synthetos.com (ROADMAP P0-04,
 * RUN_PLAN §6.4, T-S25). This is the only module allowed to touch an
 * HTML-parsing or script-URL sink (eslint `run/no-html-sink` exempts it), and
 * a change to it needs safety-path review.
 *
 * The CSP says `require-trusted-types-for 'script'; trusted-types rs-worker
 * rs-svg-export` without `'allow-duplicates'`, so:
 * - no other policy name (including `default`) can ever be created;
 * - each of these two names can be created exactly once per page.
 * `installTrustedTypes()` therefore is the first statement of every entry and
 * claims both names before the entry does anything else; nothing later can
 * create a policy. (ES module imports are hoisted, so the top-level code of
 * the modules an entry imports, such as preact, evaluates earlier. None of
 * them creates a policy; if one ever did, `createPolicy` here would throw
 * under the CSP, the shell would not mount, and the Playwright suite fails.)
 *
 * - `rs-worker` turns a path into a TrustedScriptURL only for a same-origin
 *   `/assets/**.js` chunk (the machine, gcode and sync workers, RUN_PLAN §5.4).
 * - `rs-svg-export` turns a string into TrustedHTML only when the wiring
 *   export renderer produced it (`brandSvgExport`), so an SVG export is the
 *   only markup the app ever turns into a document-like value. The export is
 *   only ever downloaded (`<a download>`), never opened as a `blob:`
 *   document, which would inherit run's origin (RUN_PLAN §6.4).
 *
 * Rendering on screen never goes through these: on-screen SVG is built with
 * createElementNS, never with markup.
 */

export const RS_WORKER = 'rs-worker';
export const RS_SVG_EXPORT = 'rs-svg-export';

/** The subset of the Trusted Types API this module uses (Chrome and Edge ship it). */
export interface TrustedValue {
  toString(): string;
}
export interface PolicyRules {
  createHTML?: (input: string) => string;
  createScriptURL?: (input: string) => string;
}
export interface PolicyLike {
  createHTML(input: string): TrustedValue;
  createScriptURL(input: string): TrustedValue;
}
export interface PolicyFactoryLike {
  createPolicy(name: string, rules: PolicyRules): PolicyLike;
}

export class TrustedTypesError extends Error {
  override readonly name = 'TrustedTypesError';
}

/** Path prefix of the build's hashed chunks (Vite `base: '/'`, `assets/`). */
export const ASSET_PREFIX = '/assets/';

/**
 * The `rs-worker` rule. Returns the absolute URL when `input` names a
 * same-origin `/assets/**.js` file with no query, fragment, credentials,
 * percent-escapes or dot segments; throws otherwise.
 */
export function checkWorkerScriptUrl(input: string, origin: string): string {
  const fail = (why: string): never => {
    throw new TrustedTypesError(`${RS_WORKER}: refused ${JSON.stringify(input)}: ${why}`);
  };
  if (/[\\%\s]/.test(input)) fail('backslash, percent-escape or whitespace');
  if (/(^|\/)\.\.?(\/|$)/.test(input)) fail('dot segment');
  let url: URL;
  try {
    url = new URL(input, origin);
  } catch {
    return fail('not a URL');
  }
  if (url.origin !== origin) fail(`not same-origin (${url.origin})`);
  if (url.username !== '' || url.password !== '') fail('credentials');
  if (url.search !== '' || url.hash !== '' || input.includes('?') || input.includes('#')) fail('query or fragment');
  if (!url.pathname.startsWith(ASSET_PREFIX)) fail(`not under ${ASSET_PREFIX}`);
  if (!url.pathname.endsWith('.js')) fail('not a .js chunk');
  if (url.pathname.includes('//')) fail('empty path segment');
  return url.href;
}

declare const svgExportBrand: unique symbol;
/** A string produced by the wiring SVG export renderer (brand checked at compile time and at run time). */
export type SvgExport = string & { readonly [svgExportBrand]: true };

/** Export strings issued by `brandSvgExport` and not yet turned into TrustedHTML. One use each. */
const issuedSvgExports = new Set<string>();

/** Markup an export must never contain: script, event handlers, script URLs, embedded HTML or external references. */
const FORBIDDEN_SVG = [
  /<\s*script/i,
  /<\s*foreignObject/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /<\s*(iframe|embed|object|use|image|a)\b/i,
  /href\s*=/i,
  /<!ENTITY|<!DOCTYPE/i,
  // External CSS (P0-04 review): a style element or attribute, @import, url().
  /<\s*([a-z]+:)?style\b/i,
  /\sstyle\s*=/i,
];

/**
 * The POSITIVE allowlist of an export (P0-04 review): drawing elements and
 * presentation attributes that cannot load anything. No `style` (element or
 * attribute: CSS can @import and url()), no attribute that takes a URL
 * (`filter`, `mask`, `clip-path`, `marker-*`, `cursor`, any `href`), no
 * gradient, pattern, image, use or font element.
 */
const SVG_ELEMENTS = new Set(['svg', 'g', 'title', 'desc', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan']);
const SVG_ATTRIBUTES = new Set([
  'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy', 'd', 'points',
  'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'font-family', 'font-size',
  'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'id', 'class', 'role', 'aria-label', 'preserveAspectRatio',
]);
const SVG_NS = 'http://www.w3.org/2000/svg';
/** The only character references allowed: the five predefined XML entities (the renderer escapes with these). */
const ENTITY = /&(?!(?:amp|lt|gt|quot|apos);)/;
/** In an attribute value: no URL function, no at-rule, no CSS escape, no markup (whitespace and case ignored). */
const BAD_VALUE = /url\s*\(|@|\\|[<>]/i;

function refuseExport(why: string): never {
  throw new TrustedTypesError(`${RS_SVG_EXPORT}: forbidden content (${why})`);
}

/** Walks the markup with the allowlist; throws on anything outside it. */
function checkSvgAllowlist(svg: string): void {
  const tag = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s+[A-Za-z][A-Za-z0-9:-]*\s*=\s*"[^"]*")*)\s*(\/?)>/y;
  const attr = /\s+([A-Za-z][A-Za-z0-9:-]*)\s*=\s*"([^"]*)"/gy;
  let i = 0;
  let depth = 0;
  let closedRoot = false;
  while (i < svg.length) {
    const lt = svg.indexOf('<', i);
    const text = svg.slice(i, lt === -1 ? svg.length : lt);
    if (ENTITY.test(text)) refuseExport('character reference or stray &');
    if (closedRoot && text.trim() !== '') refuseExport('content after the root');
    if (lt === -1) break;
    if (closedRoot) refuseExport('content after the root');
    tag.lastIndex = lt;
    const m = tag.exec(svg);
    if (m === null) refuseExport('not an allowed tag (comment, CDATA, processing instruction or malformed markup)');
    const [whole, close, name = '', attrs = '', selfClose] = m;
    if (!SVG_ELEMENTS.has(name)) refuseExport(`element ${name}`);
    if (close === '/') {
      if (attrs !== '' || selfClose === '/') refuseExport('malformed closing tag');
      depth -= 1;
      if (depth < 0) refuseExport('unbalanced closing tag');
      if (depth === 0) closedRoot = true;
    } else {
      if ((depth === 0) !== (name === 'svg')) refuseExport(depth === 0 ? 'root is not svg' : 'nested svg');
      let namespaced = false;
      for (const a of attrs.matchAll(attr)) {
        const [, attrName = '', value = ''] = a;
        if (attrName === 'xmlns') {
          if (depth !== 0 || value !== SVG_NS) refuseExport('namespace declaration');
          namespaced = true;
          continue;
        }
        if (!SVG_ATTRIBUTES.has(attrName)) refuseExport(`attribute ${attrName}`);
        if (BAD_VALUE.test(value) || ENTITY.test(value)) refuseExport(`value of ${attrName}`);
      }
      if (depth === 0 && !namespaced) refuseExport('the root has no SVG namespace');
      if (selfClose === '/') {
        if (depth === 0) refuseExport('empty root');
      } else depth += 1;
    }
    i = lt + whole.length;
  }
  if (!closedRoot) refuseExport('the root is not closed');
}

/**
 * Brands a complete SVG document from the wiring export renderer. Only that
 * renderer calls this (it XML-escapes every label). The content is checked
 * again here against a positive allowlist: anything that could run script,
 * load a resource (external CSS included) or embed HTML is refused.
 */
export function brandSvgExport(svg: string): SvgExport {
  // The namespace is compared as the exact SVG_NS string: a regex spelling of it is not a form the bundle scan allows.
  const open = /^<svg\s[^>]*>/.exec(svg)?.[0];
  if (open === undefined || !open.includes(`xmlns="${SVG_NS}"`) || !/<\/svg>\s*$/.test(svg)) {
    throw new TrustedTypesError(`${RS_SVG_EXPORT}: not a complete SVG document`);
  }
  const bad = FORBIDDEN_SVG.find((re) => re.test(svg));
  if (bad !== undefined) throw new TrustedTypesError(`${RS_SVG_EXPORT}: forbidden content (${bad.source})`);
  checkSvgAllowlist(svg);
  issuedSvgExports.add(svg);
  return svg as SvgExport;
}

/** The `rs-svg-export` rule: only a string issued by `brandSvgExport`, once. */
export function checkSvgExport(input: string): string {
  if (!issuedSvgExports.delete(input)) {
    throw new TrustedTypesError(`${RS_SVG_EXPORT}: refused a string the export renderer did not produce`);
  }
  return input;
}

function refuse(policy: string, sink: string): (input: string) => string {
  return () => {
    throw new TrustedTypesError(`${policy}: ${sink} is not allowed by this policy`);
  };
}

/** What the app uses: never the raw policy objects. */
export interface RunTrustedTypes {
  /** A TrustedScriptURL for a same-origin worker chunk, for `new Worker(...)`. */
  workerScriptUrl(path: string): TrustedValue;
  /** A Blob of a branded SVG export, for an `<a download>` link only. */
  svgExportBlob(svg: SvgExport): Blob;
}

/**
 * Creates both policies from `factory`. Throws if the factory refuses (for
 * example a second call on the same page under the production CSP).
 */
export function createRunPolicies(factory: PolicyFactoryLike, origin: string): RunTrustedTypes {
  const worker = factory.createPolicy(RS_WORKER, {
    createScriptURL: (input) => checkWorkerScriptUrl(input, origin),
    createHTML: refuse(RS_WORKER, 'createHTML'),
  });
  const svg = factory.createPolicy(RS_SVG_EXPORT, {
    createHTML: (input) => checkSvgExport(input),
    createScriptURL: refuse(RS_SVG_EXPORT, 'createScriptURL'),
  });
  return {
    workerScriptUrl: (path) => worker.createScriptURL(path),
    svgExportBlob: (markup) => new Blob([svg.createHTML(markup).toString()], { type: 'image/svg+xml' }),
  };
}

let installed: RunTrustedTypes | null | undefined;

/**
 * Claims both policy names for this page. Call it first in every entry.
 * Idempotent: later calls return the same object. Returns null when the
 * browser has no Trusted Types (not a supported browser); every use then
 * fails closed, because there is no policy to produce a trusted value.
 */
export function installTrustedTypes(): RunTrustedTypes | null {
  if (installed !== undefined) return installed;
  const factory = (globalThis as { trustedTypes?: PolicyFactoryLike }).trustedTypes;
  installed = factory === undefined ? null : createRunPolicies(factory, globalThis.location.origin);
  return installed;
}
