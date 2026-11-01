/**
 * Pure origin rules for the E2E origin guard (ROADMAP P0-06, T-S25,
 * SAFETY H12). No Playwright, no Node: unit-tested in tools/e2e/test.
 */

/** How a URL the page asked for relates to the origin under test. */
export type UrlClass = 'same-origin' | 'local' | 'external';

/**
 * `data:` and `about:` (about:blank, about:srcdoc) never leave the browser.
 * `blob:` URLs carry their creator's origin, which `URL.origin` exposes, so a
 * blob URL is same-origin only when it was minted by the origin under test.
 * Everything else, including anything unparseable, is external: the guard
 * fails closed.
 */
export function classifyUrl(url: string, origin: string): UrlClass {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'external';
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'about:') return 'local';
  return parsed.origin === origin ? 'same-origin' : 'external';
}

/** The origin of Playwright's `baseURL`. Refuses a missing or opaque base. */
export function originOf(baseURL: string | undefined): string {
  if (baseURL === undefined) throw new Error('origin guard: no baseURL is configured');
  const origin = new URL(baseURL).origin;
  if (origin === 'null') throw new Error(`origin guard: ${baseURL} has an opaque origin`);
  return origin;
}

/**
 * The URLs in a `srcset` value. Candidates are separated by commas that are
 * followed by whitespace or end a descriptor; a URL itself may contain commas
 * (data: URLs), so split on the descriptor boundaries only.
 */
export function srcsetUrls(value: string): string[] {
  const out: string[] = [];
  for (const candidate of value.split(/,\s+|,$/)) {
    const url = candidate.trim().split(/\s+/)[0];
    if (url !== undefined && url !== '') out.push(url.replace(/,$/, ''));
  }
  return out;
}

/** The URL in a `<meta http-equiv="refresh" content="5; url=...">` value, if any. */
export function refreshUrl(content: string): string | undefined {
  const match = /;\s*url\s*=\s*['"]?([^'"]+)['"]?\s*$/i.exec(content);
  return match?.[1]?.trim();
}

/**
 * The absolute target of a redirect response, or undefined when the response
 * is not a redirect the browser would follow. A redirect status with a
 * Location that does not resolve is returned as the raw value, which
 * `classifyUrl` then treats as external: the guard fails closed.
 *
 * Why the guard needs this: Chromium follows a redirect hop inside the
 * network stack without asking the context's routes again (also after a
 * route fulfilled the redirect itself), so a same-origin request that the
 * server answers with `302 Location: <third party>` would reach the third
 * party even though every direct request to it is aborted. The guard
 * therefore never hands a redirect to the browser: it follows each hop
 * itself, checking the hop's target before sending it.
 */
export function redirectTarget(status: number, location: string | undefined, from: string): string | undefined {
  if (status < 300 || status > 399 || status === 304) return undefined;
  if (location === undefined) return undefined;
  try {
    return new URL(location, from).href;
  } catch {
    return location;
  }
}

/** Most redirect hops the guard follows for one request (Chromium's own limit is 20). */
export const MAX_REDIRECT_HOPS = 20;

/**
 * The method of the next hop, as the Fetch standard has the browser do it:
 * 303 turns anything but HEAD into GET, 301 and 302 turn POST into GET, and
 * 307 and 308 keep the method and body. `dropBody` is true when the body
 * must not be sent again.
 */
export function redirectMethod(status: number, method: string): { readonly method: string; readonly dropBody: boolean } {
  const upper = method.toUpperCase();
  if ((status === 303 && upper !== 'GET' && upper !== 'HEAD') || ((status === 301 || status === 302) && upper === 'POST')) {
    return { method: 'GET', dropBody: true };
  }
  return { method: upper, dropBody: false };
}

/** One reason the origin guard fails a test. */
export interface GuardFinding {
  readonly kind: 'request' | 'redirect' | 'websocket' | 'dom' | 'csp';
  readonly url: string;
  readonly detail: string;
}

/** The prefix of every failure the guard raises; the canary looks for it. */
export const GUARD_PREFIX = 'origin guard:';

/** The failure message for a set of findings, or undefined when there are none. */
export function guardMessage(findings: readonly GuardFinding[]): string | undefined {
  if (findings.length === 0) return undefined;
  const lines = findings.map((f) => `  ${f.kind} ${f.url} (${f.detail})`);
  return `${GUARD_PREFIX} ${findings.length} finding(s); nothing may load from outside the origin under test and nothing may violate the CSP (T-S25, SAFETY H12):\n${lines.join('\n')}`;
}

/** A resource-loading attribute as the in-page scan reports it (raw, unparsed). */
export interface DomReference {
  /** Lower-case local name of the element. */
  readonly tag: string;
  /** Lower-case attribute name. */
  readonly attr: string;
  readonly value: string;
  /** The document's base URL, for resolving relative values. */
  readonly baseURI: string;
}

/**
 * The absolute URLs a reported attribute makes the browser load. Values that
 * do not resolve are skipped here because the browser cannot load them
 * either. Hyperlinks (`<a href>`, `<area href>`) are navigations the user
 * chooses, not loads, and are never reported by the scan; `ping` on them is
 * reported, because it sends a request on click.
 */
export function domReferenceUrls(ref: DomReference): string[] {
  let raw: string[];
  if (ref.attr === 'srcset' || ref.attr === 'imagesrcset') raw = srcsetUrls(ref.value);
  else if (ref.attr === 'ping') raw = ref.value.split(/\s+/).filter((v) => v !== '');
  else if (ref.attr === 'content') {
    const url = refreshUrl(ref.value);
    raw = url === undefined ? [] : [url];
  } else raw = [ref.value.trim()];
  const out: string[] = [];
  for (const value of raw) {
    try {
      out.push(new URL(value, ref.baseURI).href);
    } catch {
      // Unresolvable: the browser cannot load it.
    }
  }
  return out;
}
