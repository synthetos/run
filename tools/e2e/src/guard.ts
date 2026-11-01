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
import type { BrowserContext, Page, Request, WebSocket } from '@playwright/test';
import { classifyUrl, domReferenceUrls, guardMessage, type DomReference, type GuardFinding } from './origin.ts';

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
  // And never let one reach the network.
  await context.route(
    (url) => external(url.href),
    (route) => route.abort('blockedbyclient'),
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
