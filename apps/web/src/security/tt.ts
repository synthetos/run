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
];

/**
 * Brands a complete SVG document from the wiring export renderer. Only that
 * renderer calls this (it XML-escapes every label). The content is checked
 * again here: anything that could run script, load a resource or embed HTML
 * is refused.
 */
export function brandSvgExport(svg: string): SvgExport {
  if (!/^<svg\s[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg) || !/<\/svg>\s*$/.test(svg)) {
    throw new TrustedTypesError(`${RS_SVG_EXPORT}: not a complete SVG document`);
  }
  const bad = FORBIDDEN_SVG.find((re) => re.test(svg));
  if (bad !== undefined) throw new TrustedTypesError(`${RS_SVG_EXPORT}: forbidden content (${bad.source})`);
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
