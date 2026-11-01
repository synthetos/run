/**
 * The origin guard (ROADMAP P0-06: the e2e job "intercepts requests to
 * assert no external origins"; T-S25, SAFETY H12).
 *
 * Installed on every browser context the suite uses (the `context` of every
 * test through specs/fixtures.ts, and any context a test creates itself).
 * It fails the test on any of:
 *
 * - **request**: any request to a URL outside the origin under test. The
 *   request is also aborted by a route, so even a guard failure never sends a
 *   byte to a third party from CI.
 * - **redirect**: a same-origin response that redirects outside the origin.
 *   Chromium follows redirect hops without consulting the routes, even after
 *   a route fulfilled the redirect, so the browser never sees a redirect:
 *   the guard fetches every same-origin request itself with redirects
 *   disabled, follows same-origin hops itself (each target checked before
 *   it is requested), aborts at the first external target, and fulfills the
 *   final response. A redirected document therefore keeps the URL it was
 *   requested at; the suite's pages use absolute paths, so nothing resolves
 *   differently.
 * - **API requests**: the `request` fixture bypasses the context's routes, so
 *   it is wrapped by `guardRequestContext`, which applies the same request
 *   and redirect rules and throws instead of recording.
 * - **websocket**: any WebSocket outside the origin (also closed by a route).
 * - **dom**: any resource-loading attribute in a document that points
 *   outside the origin (img/script/iframe `src`, `srcset`, every `<link
 *   href>` including preconnect and dns-prefetch, `poster`, `object data`,
 *   SVG `href`, `ping`, `form action`, meta refresh). An independent second
 *   layer: it does not depend on how Playwright reports CSP-blocked loads,
 *   and it catches hints such as dns-prefetch that never become requests.
 * - **csp**: any Content-Security-Policy violation, unless the test declares
 *   the directive as expected (csp.e2e.ts and trusted-types.e2e.ts provoke
 *   violations on purpose and assert them themselves).
 */
import type { APIRequestContext, APIResponse, BrowserContext, Page, Request, WebSocket } from '@playwright/test';
import {
  GUARD_PREFIX,
  MAX_REDIRECT_HOPS,
  classifyUrl,
  domReferenceUrls,
  guardMessage,
  redirectMethod,
  redirectTarget,
  type DomReference,
  type GuardFinding,
} from './origin.ts';

const BINDING = '__runOriginGuard';

/** Upper bound on waiting for a page to deliver its last reports. */
const SETTLE_CAP_MS = 2000;

interface ReportedViolation {
  readonly directive: string;
  readonly blocked: string;
  readonly sample: string;
  readonly document: string;
}

type Report = { readonly type: 'dom'; readonly refs: DomReference[]; readonly document: string } | ({ readonly type: 'csp' } & ReportedViolation);

/**
 * Runs in every document before its own scripts. Self-contained (Playwright
 * serialises it): it only collects raw attribute values and violation events
 * and hands them to the Node side, where origin.ts classifies them.
 */
function pageScript(binding: string): void {
  const report = (globalThis as unknown as Record<string, (r: unknown) => Promise<void>>)[binding];
  if (typeof report !== 'function') return;
  document.addEventListener('securitypolicyviolation', (e) => {
    void report({ type: 'csp', directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample, document: document.URL });
  });
  const scan = (): void => {
    const refs: { tag: string; attr: string; value: string; baseURI: string }[] = [];
    const add = (el: Element, attr: string): void => {
      const value = el.getAttribute(attr);
      if (value !== null) refs.push({ tag: el.localName.toLowerCase(), attr, value, baseURI: document.baseURI });
    };
    for (const el of document.querySelectorAll('[src]')) add(el, 'src');
    for (const el of document.querySelectorAll('[srcset]')) add(el, 'srcset');
    for (const el of document.querySelectorAll('link[imagesrcset]')) add(el, 'imagesrcset');
    for (const el of document.querySelectorAll('[poster]')) add(el, 'poster');
    for (const el of document.querySelectorAll('object[data]')) add(el, 'data');
    for (const el of document.querySelectorAll('[ping]')) add(el, 'ping');
    for (const el of document.querySelectorAll('form[action]')) add(el, 'action');
    for (const el of document.querySelectorAll('[formaction]')) add(el, 'formaction');
    for (const el of document.querySelectorAll('[background]')) add(el, 'background');
    for (const el of document.querySelectorAll('meta[http-equiv]')) {
      if ((el.getAttribute('http-equiv') ?? '').toLowerCase() === 'refresh') add(el, 'content');
    }
    // Every href except hyperlinks (a, area), which load nothing until the
    // user follows them. Covers <link> of every rel, <base>, SVG <use> and <image>.
    for (const el of document.querySelectorAll('[href]')) {
      const tag = el.localName.toLowerCase();
      if (tag !== 'a' && tag !== 'area') add(el, 'href');
    }
    for (const el of document.querySelectorAll('[*|href]')) {
      const xlink = el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (xlink !== null && el.localName.toLowerCase() !== 'a') refs.push({ tag: el.localName.toLowerCase(), attr: 'xlink:href', value: xlink, baseURI: document.baseURI });
    }
    void report({ type: 'dom', refs, document: document.URL });
  };
  document.addEventListener('DOMContentLoaded', scan);
  addEventListener('load', scan);
}

export interface OriginGuard {
  /** Everything found so far (live). */
  readonly findings: readonly GuardFinding[];
  /** Every CSP violation reported so far, expected or not (live). */
  readonly violations: readonly ReportedViolation[];
  /**
   * Lets in-flight reports arrive, then throws the guard message if there is
   * any finding. Violations of the `allowed` directives are not findings.
   */
  assertClean(allowed?: readonly string[]): Promise<void>;
}

/** Where a request came from, for the failure message. Service-worker requests have no frame. */
function requester(r: Request): string {
  try {
    return r.frame().url();
  } catch {
    return 'a service worker';
  }
}

/**
 * Guards an APIRequestContext (the `request` fixture). Its requests are sent
 * from Node, never through a browser context, so the context's routes do not
 * see them, and by default it follows up to 20 redirects to any origin. A
 * spec calling `request.get('/auth/login')` would therefore reach a third
 * party (a sign-in redirect) before any assertion ran.
 *
 * The wrapper refuses a URL outside the origin before it is sent, sends every
 * request with redirects disabled, follows same-origin hops itself (each
 * target checked before it is requested, at most the caller's `maxRedirects`
 * and never more than MAX_REDIRECT_HOPS), and throws the guard message at the
 * first external hop. A caller's `maxRedirects: 0` returns the redirect as is.
 */
export function guardRequestContext(context: APIRequestContext, origin: string): APIRequestContext {
  const refuse = (finding: GuardFinding): never => {
    throw new Error(guardMessage([finding]) ?? GUARD_PREFIX);
  };
  const send = async (target: string | Request, options: RequestOptions = {}, method?: string): Promise<APIResponse> => {
    const requested = typeof target === 'string' ? target : target.url();
    let url: string;
    try {
      url = new URL(requested, `${origin}/`).href;
    } catch {
      url = requested;
    }
    if (classifyUrl(url, origin) !== 'same-origin') refuse({ kind: 'request', url, detail: 'API request' });
    let currentMethod = (method ?? options.method ?? (typeof target === 'string' ? 'GET' : target.method())).toUpperCase();
    const limit = Math.min(options.maxRedirects ?? MAX_REDIRECT_HOPS, MAX_REDIRECT_HOPS);
    let current: RequestOptions = { ...options };
    for (let hop = 0; ; hop++) {
      const response = await context.fetch(hop === 0 && typeof target !== 'string' ? target : url, { ...current, method: currentMethod, maxRedirects: 0 });
      const next = redirectTarget(response.status(), response.headers()['location'], url);
      if (next === undefined || options.maxRedirects === 0) return response;
      if (classifyUrl(next, origin) !== 'same-origin') refuse({ kind: 'redirect', url: next, detail: `${response.status()} from ${url} (API request)` });
      if (hop >= limit) refuse({ kind: 'redirect', url: next, detail: `more than ${limit} hops from ${requested} (API request)` });
      const nextMethod = redirectMethod(response.status(), currentMethod);
      currentMethod = nextMethod.method;
      if (nextMethod.dropBody) {
        const { data: _data, form: _form, multipart: _multipart, ...rest } = current;
        current = rest;
      }
      url = next;
    }
  };
  const verbs: Readonly<Record<string, string>> = { get: 'GET', head: 'HEAD', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE' };
  return new Proxy(context, {
    get(target, prop, receiver): unknown {
      if (prop === 'fetch') return (url: string | Request, options?: RequestOptions) => send(url, options);
      if (typeof prop === 'string' && Object.hasOwn(verbs, prop)) return (url: string, options?: RequestOptions) => send(url, options, verbs[prop]);
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

type RequestOptions = NonNullable<Parameters<APIRequestContext['fetch']>[1]>;

/** Installs the guard on a context. Call before the context's first navigation. */
export async function installOriginGuard(context: BrowserContext, origin: string): Promise<OriginGuard> {
  const findings: GuardFinding[] = [];
  const violations: ReportedViolation[] = [];
  const seen = new Set<string>();
  const add = (finding: GuardFinding): void => {
    const key = `${finding.kind} ${finding.url} ${finding.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };
  const external = (url: string): boolean => classifyUrl(url, origin) === 'external';

  // Record every request the context makes, whoever routes it (a page-level
  // route in a spec still raises this event).
  context.on('request', (r: Request) => {
    if (external(r.url())) add({ kind: 'request', url: r.url(), detail: `${r.resourceType()} from ${requester(r)}` });
  });
  // And never let one reach the network, directly or through a redirect hop.
  await context.route(
    () => true,
    async (route) => {
      const request = route.request();
      let url = request.url();
      if (external(url)) return route.abort('blockedbyclient');
      let method = request.method();
      let postData: Buffer | undefined = request.postDataBuffer() ?? undefined;
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        let response: APIResponse;
        try {
          response = await route.fetch({ url, method, ...(postData === undefined ? {} : { postData }), maxRedirects: 0 });
        } catch {
          return route.abort('failed');
        }
        const status = response.status();
        const target = redirectTarget(status, response.headers()['location'], url);
        if (target === undefined) return route.fulfill({ response });
        if (external(target)) {
          add({ kind: 'redirect', url: target, detail: `${status} from ${url}` });
          return route.abort('blockedbyclient');
        }
        const next = redirectMethod(status, method);
        method = next.method;
        if (next.dropBody) postData = undefined;
        url = target;
      }
      add({ kind: 'redirect', url, detail: `more than ${MAX_REDIRECT_HOPS} hops from ${request.url()}` });
      return route.abort('blockedbyclient');
    },
  );
  await context.routeWebSocket(
    (url) => external(url.href),
    (ws) => {
      add({ kind: 'websocket', url: ws.url(), detail: 'blocked' });
      return ws.close();
    },
  );
  const watchPage = (page: Page): void => {
    page.on('websocket', (ws: WebSocket) => {
      if (external(ws.url())) add({ kind: 'websocket', url: ws.url(), detail: `from ${page.url()}` });
    });
  };
  context.pages().forEach(watchPage);
  context.on('page', watchPage);

  await context.exposeBinding(BINDING, (_source, report: Report) => {
    if (report.type === 'csp') {
      violations.push({ directive: report.directive, blocked: report.blocked, sample: report.sample, document: report.document });
      return;
    }
    for (const ref of report.refs) {
      for (const url of domReferenceUrls(ref)) {
        if (external(url)) add({ kind: 'dom', url, detail: `<${ref.tag} ${ref.attr}> in ${report.document}` });
      }
    }
  });
  await context.addInitScript(pageScript, BINDING);

  return {
    findings,
    violations,
    async assertClean(allowed: readonly string[] = []): Promise<void> {
      // Violation events are queued tasks and binding calls are asynchronous:
      // give each live page a frame and a task to deliver them. A page with
      // JavaScript disabled runs no timers (and reports nothing), so the wait
      // is capped.
      for (const page of context.pages()) {
        if (page.isClosed()) continue;
        const settled = page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0)))).catch(() => undefined);
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([settled, new Promise<void>((done) => (timer = setTimeout(done, SETTLE_CAP_MS)))]);
        clearTimeout(timer);
      }
      const all: GuardFinding[] = [...findings];
      for (const v of violations) {
        if (!allowed.includes(v.directive)) all.push({ kind: 'csp', url: v.blocked, detail: `${v.directive} in ${v.document}${v.sample === '' ? '' : `: ${v.sample}`}` });
      }
      const message = guardMessage(all);
      if (message !== undefined) throw new Error(message);
    },
  };
}
