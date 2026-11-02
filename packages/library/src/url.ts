/**
 * External link sanitising (MACHINING_ASSISTANT §2 `datasheetUrl`, §2/§3
 * `purchase[]`, §8 "User URLs").
 *
 * Purchase and datasheet links are the user's own text. They are accepted
 * only as absolute http(s) URLs, are never fetched by the browser, and render
 * with `rel="noopener noreferrer nofollow"` in a new tab (tenet 1: following
 * a link never navigates away from the workspace).
 *
 * The check is an allowlist, deliberately stricter than the WHATWG URL
 * parser, so that anything it accepts means the same thing to every parser:
 *
 * - at most `URL_MAX_LENGTH` characters;
 * - printable ASCII only: no whitespace or control character anywhere (the
 *   WHATWG parser strips tabs and newlines, which hides a scheme), no
 *   backslash (parsed as `/`), no other character a URL must percent-encode,
 *   and every `%` starts a valid escape;
 * - the scheme is `http` or `https` (any case) followed by `//`: every other
 *   scheme, a relative or protocol-relative URL and `https:host` without the
 *   slashes are refused;
 * - no user information at all (`user:pass@`, `x@`): credentials never ride
 *   in a stored link, and `trusted.example@evil.example` cannot disguise the
 *   host;
 * - the host is a DNS name with at least two labels (ASCII; an
 *   internationalised name must be given in its `xn--` form, so a lookalike
 *   cannot pass as a familiar name) or a dotted-quad IPv4 address in plain
 *   decimal. A name whose last label is numeric or hexadecimal is parsed as
 *   IPv4 by browsers (`0x7f.1`), so it must then be a plain dotted quad.
 *   IPv6 literals are refused;
 * - a port, when present, is 1 to 65535 without leading zeros.
 *
 * The returned `href` is the normalised form (lower-case scheme and host,
 * `/` for an empty path), the one to put in the anchor.
 */

/** The longest link accepted, in characters. */
export const URL_MAX_LENGTH = 2048;

/** What `safeExternalLink` puts on the anchor (§8). */
export const EXTERNAL_LINK_REL = 'noopener noreferrer nofollow';

export type UrlProblem = 'type' | 'empty' | 'too-long' | 'characters' | 'scheme' | 'syntax' | 'credentials' | 'host' | 'port';

export type UrlCheck =
  | { readonly ok: true; readonly href: string }
  | { readonly ok: false; readonly problem: UrlProblem; readonly message: string };

export interface ExternalLink {
  readonly href: string;
  readonly rel: typeof EXTERNAL_LINK_REL;
  readonly target: '_blank';
}

/** Anything outside printable ASCII (space and controls included), or a backslash. */
const NOT_PRINTABLE_ASCII = /[^\x21-\x5b\x5d-\x7e]/;
/** Characters RFC 3986 never allows unencoded, which the WHATWG parser would rewrite. */
const UNSAFE_CHARACTERS = /["<>^`{|}]/;
const BAD_PERCENT = /%(?![0-9A-Fa-f]{2})/;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const NUMERIC_LABEL = /^(?:0x[0-9a-f]*|[0-9]+)$/;
const DECIMAL_OCTET = /^(?:0|[1-9][0-9]{0,2})$/;
const PORT = /^[1-9][0-9]{0,4}$/;

function fail(problem: UrlProblem, message: string): UrlCheck {
  return Object.freeze({ ok: false, problem, message });
}

function isIpv4(labels: readonly string[]): boolean {
  return labels.length === 4 && labels.every((l) => DECIMAL_OCTET.test(l) && Number(l) <= 255);
}

function hostProblem(host: string): string | null {
  if (host === '') return 'the link has no host';
  if (host.length > 253) return 'the host name is too long';
  const labels = host.split('.');
  if (NUMERIC_LABEL.test(labels[labels.length - 1] as string)) {
    return isIpv4(labels) ? null : 'a numeric host must be a plain dotted-quad IPv4 address';
  }
  if (labels.length < 2) return 'the host must be a full domain name';
  if (!labels.every((l) => DNS_LABEL.test(l))) return 'the host is not a valid domain name (internationalised names must use their xn-- form)';
  return null;
}

/**
 * Checks a user-supplied link. Never throws; a refusal says why, in words a
 * form can show next to the field.
 */
export function checkExternalUrl(input: unknown): UrlCheck {
  if (typeof input !== 'string') return fail('type', 'A link must be text.');
  if (input === '') return fail('empty', 'The link is empty.');
  if (input.length > URL_MAX_LENGTH) return fail('too-long', `A link is at most ${URL_MAX_LENGTH} characters.`);
  if (NOT_PRINTABLE_ASCII.test(input) || UNSAFE_CHARACTERS.test(input) || BAD_PERCENT.test(input)) {
    return fail('characters', 'The link contains spaces, control characters or characters that must be percent-encoded.');
  }
  const scheme = SCHEME.exec(input);
  const name = scheme?.[1]?.toLowerCase();
  if (name !== 'http' && name !== 'https') return fail('scheme', 'Only http and https links are allowed.');
  const rest = input.slice(name.length + 1);
  if (!rest.startsWith('//')) return fail('syntax', 'The link must start with http:// or https://.');
  const afterSlashes = rest.slice(2);
  const end = afterSlashes.search(/[/?#]/);
  const authority = end === -1 ? afterSlashes : afterSlashes.slice(0, end);
  const tail = end === -1 ? '' : afterSlashes.slice(end);
  if (authority.includes('@')) return fail('credentials', 'Links may not contain a user name or password.');
  if (authority.startsWith('[')) return fail('host', 'IPv6 address links are not supported.');
  const colon = authority.indexOf(':');
  const host = (colon === -1 ? authority : authority.slice(0, colon)).toLowerCase();
  const port = colon === -1 ? null : authority.slice(colon + 1);
  const problem = hostProblem(host);
  if (problem !== null) return fail('host', `${problem.charAt(0).toUpperCase()}${problem.slice(1)}.`);
  if (port !== null && !(PORT.test(port) && Number(port) <= 65535)) return fail('port', 'The port must be a number from 1 to 65535.');
  const path = tail === '' || !tail.startsWith('/') ? `/${tail}` : tail;
  return Object.freeze({ ok: true, href: `${name}://${host}${port === null ? '' : `:${port}`}${path}` });
}

/**
 * The anchor attributes for a user link, or null when the link is refused.
 * The browser never fetches it (§8): it is only ever a link the user clicks,
 * opened in a new tab with no opener, no referrer and no endorsement.
 */
export function safeExternalLink(url: unknown): ExternalLink | null {
  const checked = checkExternalUrl(url);
  if (!checked.ok) return null;
  return Object.freeze({ href: checked.href, rel: EXTERNAL_LINK_REL, target: '_blank' });
}
