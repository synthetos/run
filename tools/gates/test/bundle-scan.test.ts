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
  LOCK_NAME_PREFIXES,
  CLOUD_ASSET_DIR,
  type BundleFile,
  NAMESPACE_URIS,
  OUTBOUND_URLS,
  ADMITTED_REPORT_URLS,
  REPORT_URL_PREFIXES,
  REPORT_URLS,
  scanBundle as scanBundleFor,
  scanText as scanTextFor,
  SCAN_TARGETS,
  SELF_ORIGINS,
  SERIAL_ASSET_DIR,
  TESTKIT_MARKER,
  BENCH_MARKER,
} from '../src/bundle/scan.ts';
import { WEB_SERIAL_CHOOSER_MODULE, WEB_SERIAL_TRANSPORT_MODULE } from '../src/shared/webSerialNames.ts';
import { WEB_SERIAL_CHOOSER_PATH, WEB_SERIAL_TRANSPORT_PATH } from '../../../apps/web/build/chunks.ts';
import { NETWORK_IDENTIFIERS } from '../src/shared/networkIdentifiers.ts';
import { renderHeadersFile } from '../../../workers/run/src/headers.ts';

const enc = new TextEncoder();
const file = (path: string, text: string): BundleFile => ({ path, bytes: enc.encode(text) });
const page = file('index.html', '<!doctype html><script type="module" src="/assets/workspace-abc.js"></script>');
/** Every real bundle carries the generated `_headers` file (P0-04). */
const headersFile = file('_headers', renderHeadersFile());
/**
 * The Phase 0 rules below hold for every target; they run as `production`,
 * the strictest. The P1-00 target rules have their own section at the end.
 */
const scanText = (path: string, text: string) => scanTextFor(path, text, 'production');
const scanBundle = (files: readonly BundleFile[]) => scanBundleFor(files, 'production');
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

describe('report destinations (REPORT_A_PROBLEM §6)', () => {
  const run = 'https://github.com/synthetos/run/issues/new';
  const forum = 'https://synthetos.com/forum/new/';

  it('the reviewed allowance is the synthetos GitHub organisation and the forum, and every report URL is under it', () => {
    expect(REPORT_URL_PREFIXES).toEqual(['https://github.com/synthetos/', 'https://synthetos.com/forum/']);
    expect(REPORT_URLS).toContain(run);
    expect(REPORT_URLS).toContain(forum);
    for (const u of REPORT_URLS) expect(REPORT_URL_PREFIXES.some((p) => u.startsWith(p)), u).toBe(true);
    expect(ADMITTED_REPORT_URLS).toEqual(REPORT_URLS);
  });

  it('allows each report URL as a whole string literal in a JavaScript chunk', () => {
    for (const u of REPORT_URLS) {
      expect(rules('assets/workspace-abc.js', `const t={url:"${u}"};`), u).toEqual([]);
      expect(rules('assets/workspace-abc.js', `const t={url:'${u}'};`), u).toEqual([]);
    }
  });

  it('refuses anything longer, shorter or different, even under the same prefix', () => {
    expect(rules('assets/workspace-abc.js', `x("${run}?title=a")`)).toEqual(['origin-literal']);
    expect(rules('assets/workspace-abc.js', `x(\`${run}?title=\${t}\`)`)).toEqual(['origin-literal']);
    expect(rules('assets/workspace-abc.js', 'x("https://github.com/synthetos/")')).toEqual(['origin-literal']);
    expect(rules('assets/workspace-abc.js', 'x("https://github.com/synthetos/run/issues/new2")')).toEqual(['origin-literal']);
    expect(rules('assets/workspace-abc.js', 'x("https://github.com/evil/run/issues/new")')).toEqual(['origin-literal']);
    expect(rules('assets/workspace-abc.js', 'x("https://synthetos.com/forum/admin/")')).toEqual(['origin-literal']);
  });

  it('refuses a report URL that is not a whole literal, and in markup, CSS or any other file', () => {
    expect(rules('assets/workspace-abc.js', `x("${run}'+y)`)).toEqual(['origin-literal']);
    expect(rules('index.html', `<a href="${run}">x</a>`)).toEqual(['origin-literal']);
    expect(rules('index.html', `<img src="${forum}">`)).toEqual(['origin-literal']);
    expect(rules('assets/base.css', `a{background:url("${run}")}`)).toEqual(['origin-literal']);
    expect(rules('manifest.webmanifest', `{"start_url":"${forum}"}`)).toEqual(['origin-literal']);
  });
});

describe('T-S40: the test kit (P0-13)', () => {
  it('scans for the marker value the test kit exports (packages/testkit/test/smoke.test.ts pins the export)', () => {
    expect(TESTKIT_MARKER).toBe('__SYNTHETOS_TESTKIT_DEV_ONLY__');
  });

  it('fails on the marker literal in any chunk, page or text file', () => {
    const sideEffect = `Object.defineProperty(globalThis,\`${TESTKIT_MARKER}\`,{value:!0})`;
    // globalThis passed to defineProperty is also a capability-lookup finding (P0 review, P0-13).
    expect(rules('assets/workspace-abc.js', sideEffect)).toEqual(['testkit-marker', 'capability-lookup']);
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

  it('exempts only the machine Web Lock prefix, only in JavaScript literals, only exactly (P1-06)', () => {
    expect(LOCK_NAME_PREFIXES).toEqual(['synthetos-machine']);
    expect(rules('assets/w.js', 'const n=`synthetos-machine:${id}`;l.request("synthetos-machine:ABC")')).toEqual([]);
    expect(rules('assets/w.js', 'a.href="Synthetos-Machine:x"')).toEqual(['url-scheme']);
    expect(rules('assets/w.js', 'a.href="synthetos-machine2:x"')).toEqual(['url-scheme']);
    expect(rules('index.html', '<a href="synthetos-machine:x">m</a>')).toEqual(['url-scheme']);
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
      // Each spelling is also a navigator use outside the reviewed reads (P0 review, P0-13).
      expect(new Set(rules('assets/a.js', code)), code).toEqual(new Set(['web-serial', 'capability-lookup']));
    }
  });

  it('fails on the Web Serial-only method names, which catch an alias', () => {
    expect(rules('assets/a.js', 'const n=navigator,s=n.serial;s.getPorts()')).toEqual(['web-serial', 'capability-lookup']);
    expect(rules('assets/a.js', 'const s=api.serial;s.getPorts()')).toEqual(['web-serial']);
    expect(rules('assets/a.js', 'x["requestPort"]()')).toEqual(['web-serial']);
  });

  it('fails in a cloud chunk too', () => {
    expect(rules(`${CLOUD_ASSET_DIR}cloud-x.js`, 'navigator.serial')).toEqual(['web-serial', 'capability-lookup']);
  });

  it('passes words that only contain the names, and a serial number property', () => {
    expect(rules('assets/a.js', 'const serialNumber=info.serial;requestPorts;getPortsList')).toEqual([]);
    // navigator.serialize is not Web Serial, but it is a navigator read outside the reviewed list (P0 review, P0-13).
    expect(rules('assets/a.js', 'navigator.serialize')).toEqual(['capability-lookup']);
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

describe('URLs hidden from a literal scan (P0 review)', () => {
  it('(1) a character reference in an href is refused: https&#58;//evil.example/ is an outbound link', () => {
    expect(rules('index.html', '<a href="https&#58;//evil.example/">x</a>')).toContain('character-reference-in-url');
    expect(rules('index.html', '<a href="https&colon;//evil.example/">x</a>')).toContain('character-reference-in-url');
    expect(rules('index.html', "<a href='https&#x3a;&#x2f;&#x2f;evil.example/'>x</a>")).toContain('character-reference-in-url');
    expect(rules('icon.svg', '<svg><a xlink:href="javascript&#58;x">y</a></svg>')).toContain('character-reference-in-url');
  });

  it('(2) a character-reference protocol-relative src is refused', () => {
    expect(rules('index.html', '<img src="&#47;&#47;evil.example/p.png">')).toContain('character-reference-in-url');
    expect(rules('index.html', '<img src=&sol;&sol;evil.example/p.png>')).toContain('character-reference-in-url');
  });

  it('(3) every srcset candidate is checked, not only the first', () => {
    expect(rules('index.html', '<img srcset="a.png 1x, //evil.example/b.png 2x">')).toContain('protocol-relative-url');
    expect(rules('index.html', '<img srcset="a.png 1x, b.png 2x, mailto:x 3x">')).toContain('url-scheme');
    expect(rules('index.html', '<img srcset="a.png 1x, /assets/b-AbCdEfGh.png 2x">')).toEqual([]);
  });

  it('(4) CSS image-set and any other quoted string with a protocol-relative URL or a scheme is refused', () => {
    expect(rules('assets/base-AbCdEfGh.css', '.x{background-image:image-set("//evil.example/b.png" 1x)}')).toContain('protocol-relative-url');
    expect(rules('assets/base-AbCdEfGh.css', '.x{--u:"ftp:evil"}')).toContain('url-scheme');
    expect(rules('index.html', '<style>.x{background:image-set("//evil.example/b.png" 1x)}</style>')).toContain('protocol-relative-url');
    expect(rules('index.html', '<p style=\'background:image-set("//evil.example/b.png" 1x)\'>x</p>')).toContain('protocol-relative-url');
  });

  it('leaves ordinary markup and CSS alone', () => {
    expect(rules('index.html', '<a href="/safety/?a=1&amp;b=2">s</a><p>Tom &amp; Jerry &#169;</p>')).toEqual([]);
    expect(rules('assets/base-AbCdEfGh.css', '.x{font-family:"IBM Plex Sans";content:"note: x";background:url("data:image/png;base64,AA")}')).toEqual([]);
  });
});

/** The reviewer probes as esbuild minifies them (Batch 15 #1 and #2, and the 89e2b5f verification). */
const MINIFIED_SERIAL_PROBE = '(()=>{const e=Reflect.get(navigator,["ser","ial"].join(""));Reflect.apply(Reflect.get(e,["get","Ports"].join("")),e,[]);})();\n';
const MINIFIED_DYNAMIC_IMPORT = 'async function o(n){return import(n)}export{o as loadModule};\n';

describe('computed or reflective capability lookup in the bundle (P0 review, P0-13)', () => {
  it('fails on the minified reviewer probe, which the Web Serial rule alone does not see', () => {
    const found = rules('assets/a.js', MINIFIED_SERIAL_PROBE);
    expect(found).not.toContain('web-serial');
    expect(found).toContain('capability-lookup');
    const matches = scanText('assets/a.js', MINIFIED_SERIAL_PROBE).filter((f) => f.rule === 'capability-lookup').map((f) => f.match);
    expect(matches.some((m) => m.startsWith('navigator'))).toBe(true);
    expect(matches.filter((m) => m.startsWith('Reflect'))).toHaveLength(3);
  });

  it('fails in every chunk, cloud chunks included, and in an inline script of a page', () => {
    expect(rules(`${CLOUD_ASSET_DIR}cloud-x.js`, MINIFIED_SERIAL_PROBE)).toContain('capability-lookup');
    expect(rules('index.html', `<!doctype html><script>${MINIFIED_SERIAL_PROBE}</script>`)).toContain('capability-lookup');
    expect(rules('icons/x.svg', `<svg><script>${MINIFIED_SERIAL_PROBE}</script></svg>`)).toContain('capability-lookup');
  });

  it.each([
    ['navigator passed as a value', 'f(navigator)'],
    ['navigator aliased', 'const n=navigator;'],
    ['a navigator member outside the reviewed list', 'navigator.serialize'],
    ['a computed navigator member', 'navigator[k]'],
    ['an optional computed navigator member', 'navigator?.[k]'],
    ['navigator through a global with a computed key', 'globalThis["navi"+"gator"]'],
    ['a window alias with a computed key', 'window[k]'],
    ['self with an optional computed key', 'self?.[k]'],
    ['globalThis aliased', 'let e=globalThis,t=e[$];'],
    ['globalThis passed as a value', 'Object.keys(globalThis)'],
    ['Reflect, however it is used', 'const R=Reflect;'],
    ['Chrome clientInformation', 'clientInformation[k]'],
    ['the navigator name as a string', 'Reflect.get(globalThis,"navigator")'],
  ])('%s fails', (_name, code) => {
    expect(rules('assets/a.js', code), code).toContain('capability-lookup');
  });

  it.each([
    ['globalThis.trustedTypes', 'let e=globalThis.trustedTypes;'],
    ['globalThis members', 'c(e,globalThis.location.origin);globalThis.matchMedia(`(prefers-color-scheme: dark)`);globalThis.addEventListener(`message`,e)'],
    ['a static computed member', 'globalThis["trustedTypes"];window?.[`x`]'],
    ['typeof checks', 'typeof window<"u"&&typeof navigator<"u"'],
    ['a reviewed navigator property', 'navigator.language;globalThis.navigator.userAgent;self.navigator.onLine;navigator.languages;navigator.locks'],
    ['prose that ends a sentence with a global name', 'const m=`prevention relies on the host window.`;'],
    ['names that only contain the words', 'const selfTest=1,windowSize=2,myself=3,navigatorish=4,e={}.Reflection'],
  ])('%s passes', (_name, code) => {
    expect(rules('assets/a.js', code), code).toEqual([]);
  });

  it('applies only to code: the CSP `self` keyword in the headers file and CSS are not lookups', () => {
    expect(rules('_headers', "/*\n  Content-Security-Policy: script-src 'self'\n").filter((r) => r === 'capability-lookup')).toEqual([]);
    expect(rules('assets/a.css', '.window{color:red}')).toEqual([]);
  });
});

describe('non-static dynamic import in the bundle (P0 review, P0-14)', () => {
  it('fails on the minified reviewer loader', () => {
    expect(rules('assets/machine-review.js', MINIFIED_DYNAMIC_IMPORT)).toEqual(['dynamic-import']);
  });

  it.each([
    ['a template with a substitution', 'import(`./${n}.js`)'],
    ['a concatenation', 'import("./"+n)'],
    ['a spaced call', 'import ( n )'],
  ])('%s fails', (_name, code) => {
    expect(rules('assets/a.js', code), code).toEqual(['dynamic-import']);
  });

  it('passes a literal specifier, with or without import attributes, and import.meta', () => {
    expect(rules('assets/a.js', 'import("./chunk-abc.js");import(`./b.js`);import("./c.json",{with:{type:"json"}});const u=import.meta.url;')).toEqual([]);
  });
});

describe('P1-00: scan targets and the Web Serial chunk', () => {
  const serialChunk = `${SERIAL_ASSET_DIR}web-serial-abc12345.js`;
  const transportCode = 'const s=navigator.serial;export const open=()=>s.requestPort();export const list=()=>navigator.serial.getPorts();';
  const targetRules = (target: 'production' | 'staging' | 'bench', path: string, text: string): string[] => scanTextFor(path, text, target).map((f) => f.rule);

  it('has exactly the production, staging and bench targets', () => {
    expect(SCAN_TARGETS).toEqual(['production', 'staging', 'bench']);
  });

  it("names the same transport module as the gates' canonical constant", () => {
    expect(WEB_SERIAL_TRANSPORT_PATH).toBe(WEB_SERIAL_TRANSPORT_MODULE);
  });

  it("names the same port chooser module as the gates' canonical constant (OD-3)", () => {
    expect(WEB_SERIAL_CHOOSER_PATH).toBe(WEB_SERIAL_CHOOSER_MODULE);
  });

  it('staging admits a static navigator.serial read and the Web Serial method names in the serial chunk', () => {
    expect(targetRules('staging', serialChunk, transportCode)).toEqual([]);
  });

  it('OD-29: production admits the same chunk, as staging does', () => {
    expect(targetRules('production', serialChunk, transportCode)).toEqual([]);
  });

  it.each([
    ['an ordinary chunk', 'assets/machine.worker-abc12345.js'],
    ['a cloud chunk', `${CLOUD_ASSET_DIR}cloud-abc12345.js`],
    ['a file named like the serial chunk outside assets/serial/', 'assets/web-serial-abc12345.js'],
    ['a non-JavaScript file under assets/serial/', `${SERIAL_ASSET_DIR}notes.txt`],
    ['an HTML page', 'index.html'],
  ])('staging refuses Web Serial in %s', (_name, path) => {
    const text = path.endsWith('.html') ? `<script>${transportCode}</script>` : transportCode;
    expect(targetRules('staging', path, text)).toContain('web-serial');
  });

  it('the serial chunk still gets every other rule on staging: computed lookups, Reflect, other navigator properties, network code', () => {
    expect(targetRules('staging', serialChunk, 'const s=navigator[k];')).toEqual(['capability-lookup']);
    expect(targetRules('staging', serialChunk, 'const n=navigator;n.serial;')).toEqual(['capability-lookup']);
    expect(targetRules('staging', serialChunk, 'Reflect.get(navigator,"serial")')).toEqual(['capability-lookup', 'capability-lookup']);
    expect(targetRules('staging', serialChunk, 'navigator.usb.requestDevice()')).toEqual(['capability-lookup']);
    expect(targetRules('staging', serialChunk, 'fetch("/api/x")')).toEqual(['network-identifier']);
    expect(targetRules('staging', serialChunk, `"${TESTKIT_MARKER}"`)).toEqual(['testkit-marker']);
  });

  it('OD-29: production and staging both accept a clean tree with the serial chunk, and refuse Web Serial outside it', () => {
    const tree = [page, headersFile, file(serialChunk, transportCode)];
    expect(scanBundleFor(tree, 'staging')).toEqual([]);
    expect(scanBundleFor(tree, 'production')).toEqual([]);
    expect(targetRules('production', 'assets/machine.worker-abc12345.js', transportCode)).toContain('web-serial');
  });

  it('production passes a tree without the serial chunk (the Phase 0 shell)', () => {
    expect(scanBundleFor([page, headersFile, file('assets/workspace-abc.js', 'export const a=1;')], 'production')).toEqual([]);
  });
});

describe('P1-00: the bench target and the bench marker', () => {
  const channel = file('assets/build-channel-abc12345.js', `document.documentElement.dataset.buildMarker="${BENCH_MARKER}";`);
  const serial = file(`${SERIAL_ASSET_DIR}web-serial-abc12345.js`, 'const s=navigator.serial;export const l=()=>s.getPorts();');

  it('bench accepts a marked tree, with Web Serial in the serial chunk', () => {
    expect(scanBundleFor([page, headersFile, channel, serial], 'bench')).toEqual([]);
  });

  it('bench requires the marker: the release build is refused', () => {
    expect(scanBundleFor([page, headersFile, serial], 'bench').map((f) => f.rule)).toEqual(['bench-marker-missing']);
  });

  it('staging and production refuse the marker anywhere', () => {
    expect(scanBundleFor([page, headersFile, channel], 'staging').map((f) => f.rule)).toEqual(['bench-marker']);
    expect(scanBundleFor([page, headersFile, channel], 'production').map((f) => f.rule)).toEqual(['bench-marker']);
    expect(scanTextFor('index.html', `<p data-x="${BENCH_MARKER}"></p>`, 'staging').map((f) => f.rule)).toEqual(['bench-marker']);
  });

  it('bench still refuses Web Serial outside the serial chunk, the test kit and every Phase 0 rule', () => {
    expect(scanTextFor('assets/x.js', 'navigator.serial', 'bench').map((f) => f.rule)).toEqual(['web-serial', 'capability-lookup']);
    expect(scanTextFor('assets/x.js', `"${TESTKIT_MARKER}"`, 'bench').map((f) => f.rule)).toEqual(['testkit-marker']);
    expect(scanTextFor('assets/x.js', 'fetch("/x")', 'bench').map((f) => f.rule)).toEqual(['network-identifier']);
  });
});
