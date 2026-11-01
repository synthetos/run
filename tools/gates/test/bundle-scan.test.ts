/**
 * Bundle scan (ROADMAP P0-03 acceptance: "The bundle scan fails on an origin
 * literal or network identifier outside apps/web/src/cloud"; P0-13: the test
 * kit, `transport=` handling, URL schemes other than relative, `data:` and
 * `blob:`, and Web Serial, T-S40). bundle-acceptance.test.ts runs the same
 * rules against real builds.
 */
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_URL_SCHEMES,
  CLOUD_ASSET_DIR,
  type BundleFile,
  NAMESPACE_URIS,
  OUTBOUND_URLS,
  scanBundle,
  scanText,
  SELF_ORIGINS,
  TESTKIT_MARKER,
} from '../src/bundle/scan.ts';
import { NETWORK_IDENTIFIERS } from '../src/shared/networkIdentifiers.ts';
import { renderHeadersFile } from '../../../workers/run/src/headers.ts';

const enc = new TextEncoder();
const file = (path: string, text: string): BundleFile => ({ path, bytes: enc.encode(text) });
const page = file('index.html', '<!doctype html><script type="module" src="/assets/workspace-abc.js"></script>');
/** Every real bundle carries the generated `_headers` file (P0-04). */
const headersFile = file('_headers', renderHeadersFile());
const rules = (path: string, text: string): string[] => scanText(path, text).map((f) => f.rule);

describe('origin literals', () => {
  it('fails on an https origin in an entry chunk', () => {
    expect(rules('assets/workspace-abc.js', 'const u="https://evil.example/x.js";')).toEqual(['origin-literal']);
  });

  it('fails on any scheme://, not just http(s)', () => {
    for (const url of ['wss://evil.example/s', 'ftp://evil.example', 'chrome-extension://abc/x', 'http://localhost:8787']) {
      expect(rules('assets/a.js', `x("${url}")`)).toContain('origin-literal');
    }
  });

  it("fails on run's own origin outside the cloud client: only cloud code may name an origin", () => {
    expect(rules('assets/workspace-abc.js', 'const o=`https://run.synthetos.com`;')).toEqual(['origin-literal']);
  });

  it("allows run's own origins inside a cloud chunk, and nothing else there", () => {
    for (const origin of SELF_ORIGINS) expect(rules(`${CLOUD_ASSET_DIR}cloud-x.js`, `const o="${origin}/api";`)).toEqual([]);
    expect(rules(`${CLOUD_ASSET_DIR}cloud-x.js`, 'const o="https://accounts.synthetos.com";')).toEqual(['origin-literal']);
    expect(rules(`${CLOUD_ASSET_DIR}cloud-x.js`, 'const o="https://run.synthetos.com.evil.example";')).toEqual(['origin-literal']);
  });

  it('allows the XML namespace URIs by exact match only', () => {
    for (const ns of NAMESPACE_URIS) expect(rules('assets/a.js', `createElementNS(\`${ns}\`,t)`)).toEqual([]);
    expect(rules('assets/a.js', 'x("http://www.w3.org/2000/svg/../../evil")')).toEqual(['origin-literal']);
    expect(rules('assets/a.js', 'x("http://www.w3.org.evil.example/2000/svg")')).toEqual(['origin-literal']);
  });

  it('fails on origins in HTML and CSS too', () => {
    expect(rules('index.html', '<link rel="stylesheet" href="https://fonts.example/css">')).toEqual(['origin-literal']);
    expect(rules('assets/a.css', '@font-face{src:url(https://fonts.example/a.woff2)}')).toEqual(['origin-literal']);
  });
});

describe('protocol-relative and script URLs', () => {
  it('fails on //host references in markup, CSS and string literals', () => {
    expect(rules('index.html', '<script src="//cdn.example/x.js"></script>')).toEqual(['protocol-relative-url']);
    expect(rules('assets/a.css', 'a{background:url(//cdn.example/i.png)}')).toEqual(['protocol-relative-url']);
    expect(rules('assets/a.js', 'import("//cdn.example/x.js")')).toEqual(['protocol-relative-url']);
  });

  it('does not mistake a regex or a comment marker for a URL', () => {
    expect(rules('assets/a.js', 'const r=/\\/\\//g; const s="//";')).toEqual([]);
  });

  it('fails on javascript: and vbscript: URLs', () => {
    expect(rules('index.html', '<a href="javascript:alert(1)">x</a>')).toEqual(['script-url']);
    expect(rules('assets/a.js', 'el.href="VBScript:x"')).toEqual(['script-url']);
  });
});

describe('network identifiers', () => {
  it.each(NETWORK_IDENTIFIERS)('fails on %s outside the cloud client', (name) => {
    expect(rules('assets/workspace-abc.js', `const r=${name};`)).toEqual(['network-identifier']);
  });

  it('catches a network name hidden in a string, such as globalThis["fetch"]', () => {
    expect(rules('assets/a.js', 'globalThis["fetch"]("/api")')).toEqual(['network-identifier']);
  });

  it('matches whole identifiers only', () => {
    expect(rules('assets/a.js', 'const prefetchHint=1, fetched=2, myWebSocketish=3;')).toEqual([]);
  });

  it('allows network identifiers inside a cloud chunk', () => {
    expect(rules(`${CLOUD_ASSET_DIR}cloud-x.js`, 'export const h=()=>fetch("/api/health");')).toEqual([]);
  });

  it('a chunk merely named cloud outside assets/cloud/ is not trusted', () => {
    expect(rules('assets/cloud-x.js', 'export const h=()=>fetch("/api/health");')).toEqual(['network-identifier']);
    expect(rules(`${CLOUD_ASSET_DIR}cloud-x.css`, 'fetch')).toEqual(['network-identifier']);
  });
});

describe('the whole bundle', () => {
  it('passes a clean bundle of known file types', () => {
    expect(scanBundle([page, headersFile, file('assets/workspace-abc.js', 'export const a=1;'), { path: 'fonts/plex.woff2', bytes: new Uint8Array([0, 1]) }])).toEqual([]);
  });

  it('fails closed on an unknown file type', () => {
    expect(scanBundle([page, headersFile, file('assets/x.wasm', '')]).map((f) => f.rule)).toEqual(['unknown-file-type']);
    expect(scanBundle([page, headersFile, file('README', 'x')]).map((f) => f.rule)).toEqual(['unknown-file-type']);
  });

  it('fails an empty bundle, or one without a page', () => {
    expect(scanBundle([headersFile]).map((f) => f.rule)).toEqual(['empty-bundle']);
    expect(scanBundle([headersFile, file('assets/a.js', 'x')]).map((f) => f.rule)).toEqual(['empty-bundle']);
  });

  it('reports every finding with its file', () => {
    const findings = scanBundle([page, headersFile, file('assets/a.js', 'fetch("https://evil.example")')]);
    expect(findings.map((f) => [f.file, f.rule])).toEqual([
      ['assets/a.js', 'origin-literal'],
      ['assets/a.js', 'network-identifier'],
    ]);
  });
});

describe('the _headers file (P0-04)', () => {
  it('fails when the bundle has no _headers file: assets would be served without the CSP', () => {
    const findings = scanBundle([page]);
    expect(findings.map((f) => [f.file, f.rule])).toEqual([['_headers', 'headers-file']]);
  });

  it('fails when _headers differs from the generator by a single character', () => {
    const weakened = renderHeadersFile().replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
    expect(weakened).not.toBe(renderHeadersFile());
    expect(scanBundle([page, file('_headers', weakened)]).map((f) => f.rule)).toEqual(['headers-file']);
    const dropped = renderHeadersFile().replace(/^ {2}X-Frame-Options:.*\n/m, '');
    expect(scanBundle([page, file('_headers', dropped)]).map((f) => f.rule)).toEqual(['headers-file']);
  });

  it('is recognised only at the dist root; a nested _headers is an unknown file', () => {
    expect(scanBundle([page, headersFile, file('assets/_headers', renderHeadersFile())]).map((f) => f.rule)).toEqual(['unknown-file-type']);
  });
});

describe('licence texts', () => {
  const ofl = 'This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL\n';

  it('allows the OFL FAQ URL in licenses/*.txt only', () => {
    expect(rules('licenses/IBM-Plex-OFL.txt', ofl)).toEqual([]);
    expect(rules('assets/a.js', 'x("http://scripts.sil.org/OFL")')).toEqual(['origin-literal']);
    expect(rules('licenses/sub/IBM-Plex-OFL.txt', ofl)).toEqual(['origin-literal']);
  });

  it('allows that URL by exact match only', () => {
    expect(rules('licenses/x.txt', 'see https://evil.example/OFL')).toEqual(['origin-literal']);
    expect(rules('licenses/x.txt', 'see http://scripts.sil.org/OFL.evil')).toEqual(['origin-literal']);
  });
});

describe('outbound links (P0-05)', () => {
  const url = 'https://support.google.com/chrome/answer/12929150';

  it('the reviewed list is the one the pages use, and every entry is https', () => {
    expect(OUTBOUND_URLS).toContain(url);
    for (const u of OUTBOUND_URLS) expect(u).toMatch(/^https:\/\//);
  });

  it('allows a reviewed URL as the href of an <a> in an HTML page', () => {
    expect(rules('safety/index.html', `<p>See <a href="${url}" rel="noopener noreferrer">Chrome Help</a>.</p>`)).toEqual([]);
    expect(rules('safety/index.html', `<a class="x" href='${url}'>x</a>`)).toEqual([]);
  });

  it('refuses the same URL as a resource or outside an anchor', () => {
    expect(rules('index.html', `<link rel="stylesheet" href="${url}">`)).toEqual(['origin-literal']);
    expect(rules('index.html', `<img src="${url}">`)).toEqual(['origin-literal']);
    expect(rules('index.html', `<area href="${url}">`)).toEqual(['origin-literal']);
    expect(rules('index.html', `<p>${url}</p>`)).toEqual(['origin-literal']);
    expect(rules('index.html', `<a title="${url}" href="/">x</a>`)).toEqual(['origin-literal']);
    expect(rules('index.html', `<a href="${url}?x=1">x</a>`)).toEqual(['origin-literal']);
  });

  it('refuses it in scripts, styles and other text files', () => {
    expect(rules('assets/workspace-abc.js', `location.href="${url}"`)).toEqual(['origin-literal']);
    expect(rules('assets/base.css', `a{background:url("${url}")}`)).toEqual(['origin-literal']);
    expect(rules('manifest.webmanifest', `{"start_url":"${url}"}`)).toEqual(['origin-literal']);
  });

  it('refuses an unreviewed URL even in an anchor', () => {
    expect(rules('index.html', '<a href="https://evil.example/">x</a>')).toEqual(['origin-literal']);
    expect(rules('index.html', '<a href="https://support.google.com/chrome/answer/1">x</a>')).toEqual(['origin-literal']);
  });
});

describe('T-S40: the test kit (P0-13)', () => {
  it('scans for the marker value the test kit exports (packages/testkit/test/smoke.test.ts pins the export)', () => {
    expect(TESTKIT_MARKER).toBe('__SYNTHETOS_TESTKIT_DEV_ONLY__');
  });

  it('fails on the marker literal in any chunk, page or text file', () => {
    const sideEffect = `Object.defineProperty(globalThis,\`${TESTKIT_MARKER}\`,{value:!0})`;
    expect(rules('assets/workspace-abc.js', sideEffect)).toEqual(['testkit-marker']);
    expect(rules('index.html', `<p>${TESTKIT_MARKER}</p>`)).toEqual(['testkit-marker']);
    expect(rules('manifest.webmanifest', `{"x":"${TESTKIT_MARKER}"}`)).toEqual(['testkit-marker']);
  });

  it('fails on the marker inside a cloud chunk too: no location is trusted for the test kit', () => {
    expect(rules(`${CLOUD_ASSET_DIR}cloud-x.js`, `const m="${TESTKIT_MARKER}";`)).toEqual(['testkit-marker']);
  });

  it('fails on MockSerialPort, including its toStringTag string and longer names', () => {
    expect(rules('assets/a.js', 'get[Symbol.toStringTag](){return`MockSerialPort`}')).toEqual(['mock-serial-port']);
    expect(rules('assets/a.js', 'class MockSerialPort extends EventTarget{}')).toEqual(['mock-serial-port']);
    expect(rules('assets/a.js', 'const o={MockSerialPortOptions:1}')).toEqual(['mock-serial-port']);
  });

  it('passes a bundle that merely names a serial port', () => {
    expect(rules('assets/a.js', 'const label="No serial port is open";class SerialPortInfoView{}')).toEqual([]);
  });
});

describe('T-S40: transport= query handling (P0-13)', () => {
  it('fails on transport= as query text', () => {
    expect(rules('assets/a.js', 'if(location.search.includes("?transport=sim"))x()')).toEqual(['transport-query']);
    expect(rules('assets/a.js', 'const q=`transport=${t}`')).toEqual(['transport-query']);
    expect(rules('assets/a.js', 'const m=/[?&]transport=(\\w+)/.exec(location.search)')).toEqual(['transport-query']);
    expect(rules('assets/a.js', 'location.hash==="#transport=sim"')).toEqual(['transport-query']);
    expect(rules('index.html', '<a href="/?mode=x&transport=sim">x</a>')).toEqual(['transport-query']);
    expect(rules('assets/a.js', 'u.split(";transport = sim")')).toEqual(['transport-query']);
  });

  it('fails on reading transport from URLSearchParams, in any quoting or case', () => {
    expect(rules('assets/a.js', 'new URLSearchParams(location.search).get("transport")')).toEqual(['transport-query']);
    expect(rules('assets/a.js', "p.has('transport')")).toEqual(['transport-query']);
    expect(rules('assets/a.js', 'p.getAll( `Transport` )')).toEqual(['transport-query']);
  });

  it('passes a property assignment or a word that only contains "transport"', () => {
    expect(rules('assets/a.js', 'this.transport=t;const transportState=1;o.transport==null')).toEqual([]);
    expect(rules('assets/a.js', 'm.get(transport);x.get("transportKind")')).toEqual([]);
  });
});

describe('URL schemes other than relative, data: and blob: (P0-13)', () => {
  it('allows only data: and blob:', () => {
    expect(ALLOWED_URL_SCHEMES).toEqual(['data', 'blob']);
  });

  it('passes data: and blob: URLs and relative URLs', () => {
    expect(rules('assets/a.js', 'img.src="data:image/png;base64,AAAA";const u=`blob:${x}`;a.href="/safety/"')).toEqual([]);
    expect(rules('assets/a.css', 'a{background:url("data:image/svg+xml,%3Csvg%3E")}b{background:url(/assets/i.png)}')).toEqual([]);
    expect(rules('index.html', '<img src="data:image/png;base64,AAAA"><a href="/privacy/">p</a><link href="BLOB:x">')).toEqual([]);
  });

  it('fails on other schemes in JavaScript string literals', () => {
    for (const url of ['mailto:help@synthetos.com', 'tel:+15555550100', 'about:blank', 'file:C:/x', 'intent:x#Intent;end', 'chrome:settings', 'Filesystem:x']) {
      expect(rules('assets/a.js', `a.href="${url}"`), url).toEqual(['url-scheme']);
    }
    expect(rules('assets/a.js', "open('sms:1234')")).toEqual(['url-scheme']);
    expect(rules('assets/a.js', 'a.href=`mailto:${who}`')).toEqual(['url-scheme']);
  });

  it('fails on other schemes in JSON and the web manifest', () => {
    expect(rules('manifest.webmanifest', '{"protocol_handlers":[{"protocol":"web+run","url":"mailto:%s"}]}')).toEqual(['url-scheme']);
    expect(rules('assets/x.json', '{"u":"tel:1"}')).toEqual(['url-scheme']);
  });

  it('fails on other schemes in HTML and SVG attributes and meta refresh', () => {
    expect(rules('index.html', '<a href="mailto:help@synthetos.com">mail</a>')).toEqual(['url-scheme']);
    expect(rules('index.html', '<a href=mailto:x>mail</a><form action="tel:1">')).toEqual(['url-scheme', 'url-scheme']);
    expect(rules('index.html', "<iframe src='about:blank'></iframe>")).toEqual(['url-scheme']);
    expect(rules('index.html', '<meta http-equiv="refresh" content="0; url=tel:1">')).toEqual(['url-scheme']);
    expect(rules('index.html', '<div style="background:url(file:x.png)"></div>')).toEqual(['url-scheme']);
    expect(rules('icons/i.svg', '<svg xmlns="http://www.w3.org/2000/svg"><image href="about:blank"/></svg>')).toEqual(['url-scheme']);
  });

  it('fails on other schemes in CSS url() and @import', () => {
    expect(rules('assets/a.css', 'a{background:url(about:blank)}')).toEqual(['url-scheme']);
    expect(rules('assets/a.css', "@import 'file:x.css';")).toEqual(['url-scheme']);
  });

  it('reports scheme:// once, as origin-literal, and script URLs once, as script-url', () => {
    expect(rules('assets/a.js', 'x("wss://evil.example/s")')).toEqual(['origin-literal']);
    expect(rules('index.html', '<a href="javascript:alert(1)">x</a>')).toEqual(['script-url']);
    expect(rules('assets/a.css', 'a{background:url(https://cdn.example/i.png)}')).toEqual(['origin-literal']);
  });

  it('does not mistake prose or code for a URL', () => {
    expect(rules('assets/a.js', 'throw new Error("run: #app root element is missing");const t=a?"x":"y";const o={"a":1}')).toEqual([]);
    expect(rules('index.html', '<meta name="description" content="Synthetos Run: the workspace"><meta content="width=device-width, initial-scale=1">')).toEqual([]);
    expect(rules('index.html', '<p style="color:red" title="Note:read" aria-label="W1:x" class="a:b">x</p>')).toEqual([]);
    expect(rules('licenses/IBM-Plex-OFL.txt', 'Contact: mailto:someone@example.org')).toEqual([]);
  });
});

describe('Web Serial in the bundle (Phase 0, P0-13)', () => {
  it('fails on navigator.serial in every spelling a bundle can carry', () => {
    for (const code of [
      'navigator.serial.requestPort',
      'const s=navigator.serial;',
      'navigator?.serial',
      'navigator["serial"]',
      "navigator?.['serial']",
      '"serial" in navigator',
    ]) {
      expect(rules('assets/a.js', code).length, code).toBeGreaterThan(0);
      expect(new Set(rules('assets/a.js', code)), code).toEqual(new Set(['web-serial']));
    }
  });

  it('fails on the Web Serial-only method names, which catch an alias', () => {
    expect(rules('assets/a.js', 'const n=navigator,s=n.serial;s.getPorts()')).toEqual(['web-serial']);
    expect(rules('assets/a.js', 'x["requestPort"]()')).toEqual(['web-serial']);
  });

  it('fails in a cloud chunk too', () => {
    expect(rules(`${CLOUD_ASSET_DIR}cloud-x.js`, 'navigator.serial')).toEqual(['web-serial']);
  });

  it('passes words that only contain the names, and a serial number property', () => {
    expect(rules('assets/a.js', 'const serialNumber=info.serial;navigator.serialize;requestPorts;getPortsList')).toEqual([]);
    expect(rules('index.html', '<p>Web Serial is not available in this browser.</p>')).toEqual([]);
  });
});

describe('the whole bundle (P0-13 rules)', () => {
  it('reports each P0-13 finding with its file and keeps scanning', () => {
    const findings = scanBundle([
      page,
      headersFile,
      file('assets/kit.js', `globalThis["${TESTKIT_MARKER}"]=!0;`),
      file('assets/sim.js', 'new URLSearchParams(location.search).get("transport")'),
      file('safety/index.html', '<a href="mailto:x@example.org">x</a>'),
    ]);
    expect(findings.map((f) => [f.file, f.rule])).toEqual([
      ['assets/kit.js', 'testkit-marker'],
      ['assets/sim.js', 'transport-query'],
      ['safety/index.html', 'url-scheme'],
    ]);
  });
});
