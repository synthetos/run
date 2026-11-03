/**
 * The bench console route: the page posts its wire transcript, a reader gets
 * it back as the Console tab's lines (or raw), bounded, loopback-only through
 * the server's Host check.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { request, type Server } from 'node:http';
import { BenchConsole, MAX_CONSOLE_BYTES, consoleRespond, parseConsoleLine, renderConsole } from '../src/bench/console.ts';
import { BENCH_BIND_ADDRESS, benchRespond, benchSite, listen } from '../src/bench/server.ts';
import type { TreeFile } from '../src/shared/files.ts';
import { BENCH_MARKER } from '../src/bundle/scan.ts';
import { renderHeadersFile } from '../../../workers/run/src/headers.ts';

const PORT = 8793;
const enc = new TextEncoder();
const file = (path: string, text: string): TreeFile => ({ path, bytes: enc.encode(text) });

/** A minimal clean bench tree (as in bench-server.test.ts): a page, the generated _headers, a marked channel chunk. */
function benchTree(): TreeFile[] {
  return [
    file('index.html', '<!doctype html><script type="module" src="/assets/workspace-AAAAAAAA.js"></script>'),
    file('_headers', renderHeadersFile()),
    file('assets/workspace-AAAAAAAA.js', 'import"./build-channel-BBBBBBBB.js";'),
    file('assets/build-channel-BBBBBBBB.js', `document.documentElement.dataset.buildMarker="${BENCH_MARKER}";`),
  ];
}
const dec = new TextDecoder();
const JSONL = [
  '{"t":1000,"dir":"tx","text":"{sr:null}"}',
  '{"t":1010,"dir":"rx","text":"{\\"sr\\":{\\"posx\\":194.397}}"}',
  '{"t":1020,"dir":"note","text":"probe: 1 line of output left unread by a previous program arrived before the first answer: discarded"}',
  '{"t":2030,"dir":"rx","text":"{\\"hb\\":{\\"stat\\":3}}"}',
].join('\n');

describe('renderConsole', () => {
  it('renders seconds from the first entry, an arrow per direction and the text, one line each', () => {
    expect(renderConsole(JSONL)).toBe(
      ['    0.000 → {sr:null}', '    0.010 ← {"sr":{"posx":194.397}}', '    0.020 · probe: 1 line of output left unread by a previous program arrived before the first answer: discarded', '    1.030 ← {"hb":{"stat":3}}'].join('\n') + '\n',
    );
  });

  it('skips lines that are not entries, and renders nothing for an empty or all-junk transcript', () => {
    expect(renderConsole('')).toBe('');
    expect(renderConsole('not json\n{"t":"x","dir":"tx","text":""}\n[]\n{"t":1,"dir":"up","text":""}\n{"t":1,"dir":"tx"}\n')).toBe('');
    expect(renderConsole('junk\n{"t":5,"dir":"tx","text":"a"}\n')).toBe('    0.000 → a\n');
    expect(parseConsoleLine('{"t":1,"dir":"rx","text":"b"}')).toEqual({ t: 1, dir: 'rx', text: 'b' });
    expect(parseConsoleLine('null')).toBeNull();
    expect(parseConsoleLine('{"t":Infinity}')).toBeNull();
  });
});

describe('consoleRespond', () => {
  it('before any post, GET says so without a received-at header; a POST stores the body and GET renders it; ?raw returns the JSONL', () => {
    let now = 1_700_000_000_000;
    const c = new BenchConsole(() => now);
    const empty = consoleRespond(c, 'GET', '/console', undefined);
    expect(empty.status).toBe(200);
    expect(empty.headers['x-console-received-at']).toBeUndefined();
    expect(dec.decode(empty.body)).toBe('no transcript yet: the bench page posts it once a link has opened\n');
    expect(consoleRespond(c, 'HEAD', '/console', undefined).body.byteLength).toBe(0);

    const posted = consoleRespond(c, 'POST', '/console', enc.encode(JSONL));
    expect(posted.status).toBe(204);
    now += 5000;
    const got = consoleRespond(c, 'GET', '/console', undefined);
    expect(got.headers['x-console-received-at']).toBe('2023-11-14T22:13:20.000Z');
    expect(dec.decode(got.body)).toBe(renderConsole(JSONL));
    expect(dec.decode(consoleRespond(c, 'GET', '/console?raw', undefined).body)).toBe(JSONL);
    expect(dec.decode(consoleRespond(c, 'GET', '/console?raw=1&x', undefined).body)).toBe(JSONL);
    expect(dec.decode(consoleRespond(c, 'GET', '/console?rawr', undefined).body)).toBe(renderConsole(JSONL));
    expect(consoleRespond(c, 'HEAD', '/console', undefined).headers['x-console-received-at']).toBe('2023-11-14T22:13:20.000Z');
  });

  it('refuses a POST without a body (400), an oversize body (413) and other methods (405)', () => {
    const c = new BenchConsole();
    expect(consoleRespond(c, 'POST', '/console', undefined).status).toBe(400);
    expect(consoleRespond(c, 'POST', '/console', new Uint8Array(MAX_CONSOLE_BYTES + 1)).status).toBe(413);
    expect(consoleRespond(c, 'POST', '/console', new Uint8Array(MAX_CONSOLE_BYTES)).status).toBe(204);
    const put = consoleRespond(c, 'PUT', '/console', undefined);
    expect(put.status).toBe(405);
    expect(put.headers['allow']).toBe('GET, HEAD, POST');
  });
});

describe('the bench server wires /console', () => {
  const tree = (): TreeFile[] => benchTree();

  it('routes POST and GET to the console when the site has one, keeps the Host check, and 405s a POST elsewhere', async () => {
    const console = new BenchConsole();
    const site = benchSite(tree(), undefined, console);
    const host = `localhost:${PORT}`;
    expect((await benchRespond(site, PORT, { method: 'POST', url: '/console', host, body: enc.encode(JSONL) })).status).toBe(204);
    const got = await benchRespond(site, PORT, { method: 'GET', url: '/console', host });
    expect(got.status).toBe(200);
    expect(dec.decode(got.body)).toBe(renderConsole(JSONL));
    expect(got.headers['content-security-policy']).toBeDefined();
    expect((await benchRespond(site, PORT, { method: 'POST', url: '/console', host: 'evil.example:8793', body: enc.encode(JSONL) })).status).toBe(421);
    expect((await benchRespond(site, PORT, { method: 'POST', url: '/', host, body: enc.encode('x') })).status).toBe(405);
    expect((await benchRespond(site, PORT, { method: 'GET', url: '/console/', host })).status).toBe(404);
  });

  it('without a console the path is just a missing file', async () => {
    const site = benchSite(tree());
    expect((await benchRespond(site, PORT, { method: 'GET', url: '/console', host: `localhost:${PORT}` })).status).toBe(404);
  });
});

describe('over HTTP', () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });
  const send = (port: number, method: string, path: string, body?: string): Promise<{ status: number; text: string }> =>
    new Promise((resolve, reject) => {
      const req = request({ host: BENCH_BIND_ADDRESS, port, method, path, headers: { host: `localhost:${port}`, ...(body === undefined ? {} : { 'content-type': 'text/plain' }) } }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          text += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      });
      req.on('error', reject);
      req.end(body);
    });

  it('a POST body reaches the console and GET reads it back; a body past the limit is refused', async () => {
    const { server, port } = await listen(benchSite(benchTree(), undefined, new BenchConsole()), 0);
    servers.push(server);
    expect((await send(port, 'POST', '/console', JSONL)).status).toBe(204);
    const got = await send(port, 'GET', '/console');
    expect(got.status).toBe(200);
    expect(got.text).toBe(renderConsole(JSONL));
    expect((await send(port, 'GET', '/console?raw')).text).toBe(JSONL);
    expect((await send(port, 'POST', '/console', 'x'.repeat(MAX_CONSOLE_BYTES + 10))).status).toBe(413);
    expect((await send(port, 'GET', '/console')).text).toBe(renderConsole(JSONL));
  }, 30_000);
});
