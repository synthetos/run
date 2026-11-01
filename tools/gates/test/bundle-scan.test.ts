/**
 * Bundle scan (ROADMAP P0-03 acceptance: "The bundle scan fails on an origin
 * literal or network identifier outside apps/web/src/cloud").
 */
import { describe, expect, it } from 'vitest';
import { CLOUD_ASSET_DIR, type BundleFile, NAMESPACE_URIS, OUTBOUND_URLS, scanBundle, scanText, SELF_ORIGINS } from '../src/bundle/scan.ts';
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
