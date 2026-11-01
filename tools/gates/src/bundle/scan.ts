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
 *
 * P0-13 (T-S40, SAFETY §8 item 31) adds the test kit and the Phase 0 ban on
 * Web Serial. Each rule applies to every text file, chunk or page:
 *
 * - `testkit-marker`: the literal value of `TESTKIT_MARKER`
 *   (packages/testkit/src/marker.ts). Every test-kit module loads that file,
 *   which names the marker in a side effect, so any bundled test-kit code
 *   carries it even after minification.
 * - `mock-serial-port`: the name `MockSerialPort` (the class also reports it
 *   through `Symbol.toStringTag`, a string a minifier cannot rename).
 * - `transport-query`: `transport=` as query text (after `?`, `&`, `#`, `;`,
 *   `/` or an opening quote) and a `.get`/`.has`/`.getAll` lookup of the
 *   string `transport`, the URLSearchParams way to read it. There is no
 *   `?transport=` switch to a simulator (RUN_PLAN §2). A plain property
 *   assignment such as `this.transport=t` is not query handling and passes.
 * - `url-scheme`: a URL with a scheme other than `data:` and `blob:` that the
 *   rules above do not already report (they cover `scheme://`, `//host`,
 *   `javascript:` and `vbscript:`), such as `mailto:`, `tel:`, `file:x` or
 *   `about:blank`. It looks where a URL can be: a string literal in
 *   JavaScript and JSON, a URL attribute (`href`, `src`, ...) or a meta
 *   refresh `url=` in HTML, SVG and XML, and `url(...)` or `@import` in CSS
 *   and HTML. Licence texts are
 *   prose and are not checked by this rule.
 * - `web-serial`: `navigator.serial` (also as `navigator["serial"]` or
 *   `"serial" in navigator`) and the Web Serial-only method names
 *   `requestPort` and `getPorts`, which catch an alias. Nothing in Phase 0
 *   may reach a serial port; this backs up the `run/no-web-serial` lint rule
 *   on the built output. P1-01 narrows it, like the lint rule, to the machine
 *   worker's chunk in its own owner-approved PR.
 *
 * P0 review adds rules for URLs a literal-text scan could not see:
 *
 * - `character-reference-in-url`: a character reference (`&#58;`, `&#x2f;`,
 *   `&colon;`, `&sol;`, ...) inside a URL attribute value in HTML, SVG or
 *   XML. The browser decodes it before it resolves the URL, so
 *   `href="https&#58;//evil.example/"` is an outbound link the other rules
 *   would miss. Only `&amp;` (a query-string `&`) is allowed: it can never
 *   form a scheme or `//`.
 * - `srcset` values are split on commas and every candidate is checked, not
 *   just the first.
 * - In CSS (and HTML), EVERY quoted string is checked for a leading `//` or
 *   a scheme, so `image-set("//evil.example/b.png" 1x)` is caught as well as
 *   `url()` and `@import`.
 *
 * The scan is a backstop on the built text. It cannot see a name assembled at
 * run time (`'Mock' + 'SerialPort'`); the dependency-cruiser and ESLint rules
 * on the source are the primary gates, and the marker is what makes a
 * test-kit import visible here whatever the code does with it.
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
import { TESTKIT_MARKER } from '../../../../packages/testkit/src/marker.ts';
import { WEB_SERIAL_METHODS } from '../shared/webSerialNames.ts';

export { CLOUD_ASSET_DIR, TESTKIT_MARKER };

/** URL schemes the bundle may use besides relative URLs (ROADMAP P0-13). */
export const ALLOWED_URL_SCHEMES: readonly string[] = ['data', 'blob'];

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
  | 'empty-bundle'
  | 'testkit-marker'
  | 'mock-serial-port'
  | 'transport-query'
  | 'url-scheme'
  | 'character-reference-in-url'
  | 'web-serial';

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

/**
 * `transport=` as query text: after a URL delimiter, an opening quote, or
 * regex punctuation (`[?&]transport=`, `(^|&)transport=`). None of these can
 * precede a JavaScript assignment to a `transport` variable or property.
 */
const TRANSPORT_QUERY_TEXT_RE = /[?&#;/"'`\\|()\]]transport\s*=/gi;
/** `params.get("transport")` and friends: reading it from URLSearchParams. */
const TRANSPORT_QUERY_LOOKUP_RE = /\.(?:get|getAll|has)\(\s*["'`]transport["'`]/gi;
/** A URL scheme (RFC 3986 §3.1) followed by `:`. */
const SCHEME = '[A-Za-z][A-Za-z0-9+.-]*';
/** A JavaScript or JSON string literal that starts with `scheme:` and a non-space. */
const LITERAL_SCHEME_RE = new RegExp(`["'\`](${SCHEME}):(?=[^\\s"'\`])`, 'g');
/**
 * HTML attributes whose value is a URL. Other attributes (`style`, `title`,
 * `content`) hold prose or CSS, where `word:` is not a scheme; a URL in
 * `style` is caught by the CSS rule, and one in a meta refresh by `url=`.
 */
const URL_ATTRIBUTES = 'href|src|srcset|action|formaction|poster|data|cite|background|manifest|ping|longdesc|codebase|archive|usemap|icon|xlink:href';
/** A URL attribute value, or a meta-refresh `url=`, that starts with `scheme:`. */
const MARKUP_SCHEME_RE = new RegExp(
  `(?:(?<![A-Za-z0-9_:-])(?:${URL_ATTRIBUTES})\\s*=\\s*["']?|\\burl\\s*=\\s*["']?)\\s*(${SCHEME}):`,
  'gi',
);
/** `url(scheme:...)` and `@import "scheme:..."` in CSS (also inside HTML). */
const CSS_SCHEME_RE = new RegExp(`(?:\\burl\\(\\s*["']?|@import\\s+["'])\\s*(${SCHEME}):`, 'gi');
const WEB_SERIAL_RE = new RegExp(
  [
    '\\bnavigator\\s*\\??\\.\\s*serial(?![A-Za-z0-9_$])',
    '\\bnavigator\\s*(?:\\?\\.)?\\[\\s*["\'`]serial["\'`]\\s*\\]',
    '["\'`]serial["\'`]\\s*in\\s*navigator\\b',
    `(?<![A-Za-z0-9_$])(?:${WEB_SERIAL_METHODS.join('|')})(?![A-Za-z0-9_$])`,
  ].join('|'),
  'g',
);

/** A URL attribute and its value (double-quoted, single-quoted or bare) in markup. */
const URL_ATTRIBUTE_VALUE_RE = new RegExp(`(?<![A-Za-z0-9_:-])(${URL_ATTRIBUTES})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'gi');
/** A character reference other than `&amp;`: numeric, hex, or any other named one. */
const CHARACTER_REFERENCE_RE = /&(?!amp;)(?:#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[A-Za-z][A-Za-z0-9]*;)/;
/** A CSS quoted string that starts with `//` or `scheme:` and a non-space. */
const CSS_STRING_URL_RE = new RegExp(`["'](\\/\\/|${SCHEME}:(?=[^\\s"']))`, 'g');

/** The URL-attribute rules for markup: character references in a URL, and every `srcset` candidate. */
function markupAttributeFindings(path: string, text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const match of text.matchAll(URL_ATTRIBUTE_VALUE_RE)) {
    const name = (match[1] as string).toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (CHARACTER_REFERENCE_RE.test(value)) {
      findings.push({ file: path, rule: 'character-reference-in-url', match: clip(match[0]) });
    }
    if (name !== 'srcset') continue;
    // Each candidate is "URL [descriptor]"; the first is already checked by the attribute-start rules.
    for (const candidate of value.split(',').slice(1)) {
      const url = candidate.trim().split(/\s+/)[0] ?? '';
      if (url.startsWith('//')) findings.push({ file: path, rule: 'protocol-relative-url', match: clip(`srcset … ${url}`) });
      const scheme = new RegExp(`^(${SCHEME}):`).exec(url)?.[1]?.toLowerCase();
      if (scheme !== undefined && !ALLOWED_URL_SCHEMES.includes(scheme) && !url.slice(scheme.length + 1).startsWith('//')) {
        findings.push({ file: path, rule: 'url-scheme', match: clip(`srcset … ${url}`) });
      }
    }
  }
  return findings;
}

/** Every quoted string in CSS that starts with `//` or a scheme (image-set, custom properties, ...). */
function cssStringFindings(path: string, text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const match of text.matchAll(CSS_STRING_URL_RE)) {
    const lead = match[1] as string;
    const at = (match.index ?? 0) + 1;
    // url("...") and @import "..." are the url-scheme and protocol-relative rules' own; do not report twice.
    if (/(?:url\(\s*|@import\s+)$/i.test(text.slice(Math.max(0, at - 16), at - 1))) continue;
    if (lead === '//') {
      findings.push({ file: path, rule: 'protocol-relative-url', match: clip(text.slice(at, at + 60)) });
      continue;
    }
    const scheme = lead.slice(0, -1).toLowerCase();
    if (ALLOWED_URL_SCHEMES.includes(scheme) || scheme === 'javascript' || scheme === 'vbscript' || text.startsWith('//', at + lead.length)) continue;
    findings.push({ file: path, rule: 'url-scheme', match: clip(text.slice(at, at + 60)) });
  }
  return findings;
}

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

/**
 * Reports a scheme the earlier rules have not: not `data:` or `blob:`, not
 * `scheme://` (origin-literal), not `javascript:`/`vbscript:` (script-url).
 */
function schemeFindings(path: string, text: string, re: RegExp): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const match of text.matchAll(re)) {
    const scheme = (match[1] as string).toLowerCase();
    const end = (match.index ?? 0) + match[0].length;
    if (ALLOWED_URL_SCHEMES.includes(scheme) || scheme === 'javascript' || scheme === 'vbscript') continue;
    if (text.startsWith('//', end)) continue;
    findings.push({ file: path, rule: 'url-scheme', match: clip(text.slice(match.index ?? 0, end + 30)) });
  }
  return findings;
}

/** The contents of every `<style>` element and `style="..."` attribute of an HTML page, joined. */
function styleText(html: string): string {
  const parts: string[] = [];
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) parts.push(m[1] ?? '');
  for (const m of html.matchAll(/(?<![A-Za-z0-9_:-])style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) parts.push(m[1] ?? m[2] ?? '');
  return parts.join('\n');
}

/**
 * The P0-13 rules (T-S40 and the Phase 0 Web Serial ban), which apply to
 * every text file whatever its location, cloud chunks included.
 */
function testkitAndSerialFindings(path: string, text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const ext = extension(path);
  if (text.includes(TESTKIT_MARKER)) {
    findings.push({ file: path, rule: 'testkit-marker', match: `${TESTKIT_MARKER}: test-kit code is in the bundle` });
  }
  for (const match of text.matchAll(/MockSerialPort/g)) {
    const start = Math.max(0, (match.index ?? 0) - 20);
    findings.push({ file: path, rule: 'mock-serial-port', match: `…${clip(text.slice(start, (match.index ?? 0) + 40))}…` });
  }
  for (const re of [TRANSPORT_QUERY_TEXT_RE, TRANSPORT_QUERY_LOOKUP_RE]) {
    for (const match of text.matchAll(re)) findings.push({ file: path, rule: 'transport-query', match: clip(match[0]) });
  }
  if (ext === '.js' || ext === '.mjs' || ext === '.json' || ext === '.webmanifest') {
    findings.push(...schemeFindings(path, text, LITERAL_SCHEME_RE));
  } else if (ext === '.html' || ext === '.svg' || ext === '.xml') {
    findings.push(...schemeFindings(path, text, MARKUP_SCHEME_RE), ...schemeFindings(path, text, CSS_SCHEME_RE));
    findings.push(...markupAttributeFindings(path, text));
    if (ext === '.html') findings.push(...cssStringFindings(path, styleText(text)));
  } else if (ext === '.css') {
    findings.push(...schemeFindings(path, text, CSS_SCHEME_RE), ...cssStringFindings(path, text));
  }
  for (const match of text.matchAll(WEB_SERIAL_RE)) findings.push({ file: path, rule: 'web-serial', match: clip(match[0]) });
  return findings;
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
  findings.push(...testkitAndSerialFindings(path, text));
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
