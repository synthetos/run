/**
 * Bundle scan of the built web app (ROADMAP P0-03, RUN_PLAN §6.2; extended by
 * P0-13 for T-S40).
 *
 * The page that holds the Web Serial grant must load nothing from another
 * origin and must contain network code only in the cloud client. This scan
 * reads every file of `apps/web/dist` and refuses:
 *
 * - `origin-literal`: any `scheme://` URL. Outside `assets/cloud/` none is
 *   allowed; inside it, only run's own origins. The XML namespace URIs that
 *   the DOM APIs need (`http://www.w3.org/2000/svg`, ...) are identifiers,
 *   never fetched, and are allowed by exact match only.
 * - `protocol-relative-url`: a `//host` reference in markup, CSS or a string
 *   literal.
 * - `script-url`: a `javascript:` or `vbscript:` URL.
 * - `network-identifier`: a network API name (`fetch`, `WebSocket`, ...)
 *   anywhere outside `assets/cloud/`, including inside strings, so
 *   `globalThis['fetch']` is caught too.
 * - `unknown-file-type`: a file the scan cannot classify. The scan fails
 *   closed rather than skip it.
 * - Outbound links (P0-05): the exact URLs in apps/web/src/pages/outbound.ts
 *   are allowed, and only as the `href` of an `<a>` element in an HTML page.
 *   A link is navigation the user chooses; it loads nothing into the page.
 *   The same URL anywhere else (a `<link>`, `<img>`, CSS, a script, or a
 *   JavaScript chunk) is still an `origin-literal` finding.
 * - `headers-file` (P0-04): the static-assets `_headers` file at the dist
 *   root is missing or differs from `renderHeadersFile()` in
 *   workers/run/src/headers.ts. Cloudflare applies that file to every asset
 *   response, so an artifact without it, or with a weakened copy, would serve
 *   the shell without its CSP (RUN_PLAN §6.4, T-S25).
 *
 * Which chunks live under `assets/cloud/` is decided by their contents at
 * build time (apps/web/build/chunks.ts), never by a chunk's name.
 *
 * This module imports only dependency-free modules, so the secret-free
 * `build` CI job runs it without installing dev tooling.
 */
import { CLOUD_ASSET_DIR } from '../../../../apps/web/build/chunks.ts';
import { NETWORK_IDENTIFIERS } from '../shared/networkIdentifiers.ts';
import { renderHeadersFile } from '../../../../workers/run/src/headers.ts';
import { OUTBOUND_URLS } from '../../../../apps/web/src/pages/outbound.ts';

export { CLOUD_ASSET_DIR };

/** run's own origins: the only origin literals allowed, and only in cloud chunks. */
export const SELF_ORIGINS: readonly string[] = ['https://run.synthetos.com', 'https://staging.run.synthetos.com'];

/**
 * XML namespace URIs used as identifiers by DOM APIs (createElementNS and
 * friends). They are compared, never requested. Exact match only.
 */
export const NAMESPACE_URIS: readonly string[] = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.w3.org/2000/xmlns/',
];

/**
 * URLs that appear in licence texts the bundle must ship verbatim (the SIL
 * OFL names its FAQ). Allowed by exact match, and only in `licenses/*.txt`,
 * which nothing loads as code.
 */
export const LICENCE_TEXT_URIS: readonly string[] = ['http://scripts.sil.org/OFL'];

/** The reviewed outbound links (P0-05), allowed only as `<a href>` in HTML. */
export { OUTBOUND_URLS };

/**
 * True when the URL starting at `index` in an HTML file is the whole value of
 * an `href` attribute of an `<a>` start tag: the tag is `<a ` and the
 * attribute value is quoted and ends right after the URL.
 */
function isAnchorHref(text: string, index: number, url: string): boolean {
  const quote = text[index - 1];
  if ((quote !== '"' && quote !== "'") || text[index + url.length] !== quote) return false;
  if (!/\shref=$/i.test(text.slice(Math.max(0, index - 7), index - 1))) return false;
  const tagStart = text.lastIndexOf('<', index);
  if (tagStart === -1 || text.lastIndexOf('>', index) > tagStart) return false;
  return /^<a\s/i.test(text.slice(tagStart, tagStart + 3));
}

/** Where licence texts live in dist (apps/web/public/licenses/). */
const LICENCE_TEXT_RE = /^licenses\/[^/]+\.txt$/;

/** The static-assets headers file, at the dist root only (Cloudflare reads no other). */
export const HEADERS_FILE = '_headers';

/** Files the scan reads as text. */
export const TEXT_EXTENSIONS: readonly string[] = ['.html', '.js', '.mjs', '.css', '.svg', '.json', '.webmanifest', '.txt', '.xml'];

/**
 * Binary formats the bundle may ship (fonts and images, P0-04/P0-05). They
 * cannot carry script, and the CSP serves them from 'self' only.
 */
export const BINARY_EXTENSIONS: readonly string[] = ['.woff2', '.png', '.ico', '.webp', '.avif', '.jpg', '.jpeg', '.gif'];

export type ScanRule =
  | 'origin-literal'
  | 'protocol-relative-url'
  | 'script-url'
  | 'network-identifier'
  | 'unknown-file-type'
  | 'headers-file'
  | 'empty-bundle';

export interface BundleFile {
  /** Path relative to the dist root, with forward slashes. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ScanFinding {
  readonly file: string;
  readonly rule: ScanRule;
  /** The offending text (truncated), or a short explanation. */
  readonly match: string;
}

const ORIGIN_RE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>()\\]*/g;
const SCRIPT_URL_RE = /\b(?:javascript|vbscript):/gi;
/** `src="//host"`, `href='//host'`, `url(//host)`, `@import "//host"` in markup and CSS. */
const MARKUP_PROTOCOL_RELATIVE_RE = /(?:\b(?:src|href|action|formaction|poster|srcset|data)\s*=\s*["']?|url\(\s*["']?|@import\s+["'])\/\/[^\s"'`<>()]*/gi;
/** A string literal that starts with `//` and a host name. */
const STRING_PROTOCOL_RELATIVE_RE = /["'`]\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?::\d+)?(?=[/"'`])[^"'`]*/g;
const IDENTIFIER_RE = new RegExp(`(?<![A-Za-z0-9_$])(?:${NETWORK_IDENTIFIERS.join('|')})(?![A-Za-z0-9_$])`, 'g');

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

function clip(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** True when `url` is exactly one of run's origins, optionally followed by a path. */
function isSelfOrigin(url: string): boolean {
  return SELF_ORIGINS.some((origin) => url === origin || url.startsWith(`${origin}/`));
}

/** True when the file is a cloud-client chunk, by its location in dist. */
export function isCloudAsset(path: string): boolean {
  return path.startsWith(CLOUD_ASSET_DIR) && extension(path) === '.js';
}

/** Scans one text file. Exported for the tests. */
export function scanText(path: string, text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const cloud = isCloudAsset(path);
  const ext = extension(path);

  for (const match of text.matchAll(ORIGIN_RE)) {
    const url = match[0];
    if (NAMESPACE_URIS.includes(url)) continue;
    if (LICENCE_TEXT_RE.test(path) && LICENCE_TEXT_URIS.includes(url)) continue;
    if (cloud && isSelfOrigin(url)) continue;
    if (ext === '.html' && OUTBOUND_URLS.includes(url) && isAnchorHref(text, match.index ?? 0, url)) continue;
    findings.push({ file: path, rule: 'origin-literal', match: clip(url) });
  }
  for (const match of text.matchAll(SCRIPT_URL_RE)) {
    findings.push({ file: path, rule: 'script-url', match: clip(match[0]) });
  }
  const relative = ext === '.js' || ext === '.mjs' ? STRING_PROTOCOL_RELATIVE_RE : MARKUP_PROTOCOL_RELATIVE_RE;
  for (const match of text.matchAll(relative)) {
    findings.push({ file: path, rule: 'protocol-relative-url', match: clip(match[0]) });
  }
  if (!cloud) {
    for (const match of text.matchAll(IDENTIFIER_RE)) {
      const start = Math.max(0, (match.index ?? 0) - 30);
      const context = text.slice(start, (match.index ?? 0) + match[0].length + 30);
      findings.push({ file: path, rule: 'network-identifier', match: `${match[0]} in …${clip(context)}…` });
    }
  }
  return findings;
}

/** Scans a whole bundle. An empty bundle, or one without an HTML page, fails. */
export function scanBundle(files: readonly BundleFile[]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  if (!files.some((f) => extension(f.path) === '.html')) {
    findings.push({ file: '.', rule: 'empty-bundle', match: 'no HTML page found: the scan refuses to pass an empty or partial build' });
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const headers = files.find((f) => f.path === HEADERS_FILE);
  if (headers === undefined) {
    findings.push({ file: HEADERS_FILE, rule: 'headers-file', match: 'missing: asset responses would carry no security headers' });
  } else if (decoder.decode(headers.bytes) !== renderHeadersFile()) {
    findings.push({ file: HEADERS_FILE, rule: 'headers-file', match: 'differs from renderHeadersFile() in workers/run/src/headers.ts' });
  }
  for (const file of files) {
    const ext = extension(file.path);
    if (file.path === HEADERS_FILE) {
      findings.push(...scanText(file.path, decoder.decode(file.bytes)));
    } else if (TEXT_EXTENSIONS.includes(ext)) {
      findings.push(...scanText(file.path, decoder.decode(file.bytes)));
    } else if (!BINARY_EXTENSIONS.includes(ext)) {
      findings.push({ file: file.path, rule: 'unknown-file-type', match: `extension '${ext}' is not a known text or binary asset type` });
    }
  }
  return findings;
}
