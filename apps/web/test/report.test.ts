/**
 * Report a problem (REPORT_A_PROBLEM, Phase A): the URL builder and its
 * allowlist, the redaction, the 8 kB truncation, the G-code consent default,
 * the collected items, the notices a report starts from, and the store-only
 * zip. The dialog itself is exercised in tools/e2e (fake-serial).
 */
import { describe, expect, it } from 'vitest';
import { browserFamily, environmentText, gcodeComments, gcodeExcerpt, pinText, transcriptExcerpt } from '../src/report/collect.ts';
import { cutDiagnostics, issueLink, reportMarkdown, TRUNCATION_NOTE, URL_BUDGET, type ComposeInput } from '../src/report/compose.ts';
import { composedItems, DEFAULT_GCODE_SCOPE, defaultIncluded, GCODE_CONSENT, gcodeFacts, reportItems, type ItemsInput } from '../src/report/items.ts';
import { eventNotice } from '../src/report/notice.ts';
import { REDACTED_ID, redactText, redactValue } from '../src/report/redact.ts';
import { openReport, reportRequest } from '../src/report/state.ts';
import { firmwareTarget, forumUrl, issueUrl, REPORT_TARGETS, REPORT_URLS } from '../src/report/targets.ts';
import { crc32, makeZip, zipName } from '../src/report/zip.ts';

const enc = new TextEncoder();
const hex = (s: string): string => [...enc.encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');

describe('report targets: a fixed allowlist, URLs built with encodeURIComponent only', () => {
  it('lists exactly the run, TinyG and g2core issue trackers and the forum', () => {
    expect(Object.keys(REPORT_TARGETS)).toEqual(['run', 'tinyg', 'g2core', 'forum']);
    expect(REPORT_URLS).toEqual(['https://github.com/synthetos/run/issues/new', 'https://github.com/synthetos/TinyG/issues/new', 'https://github.com/synthetos/g2core/issues/new', 'https://synthetos.com/forum/new/']);
    expect(Object.isFrozen(REPORT_TARGETS)).toBe(true);
    expect(Object.isFrozen(REPORT_TARGETS.run)).toBe(true);
  });

  it('builds the issue URL from the fixed URL plus encoded title and body', () => {
    const url = issueUrl('run', 'A & B? #1', 'line 1\nline 2 ünïcode <b>');
    expect(url).toBe(`https://github.com/synthetos/run/issues/new?title=${encodeURIComponent('A & B? #1')}&body=${encodeURIComponent('line 1\nline 2 ünïcode <b>')}`);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://github.com/synthetos/run/issues/new');
    expect([...parsed.searchParams.keys()]).toEqual(['title', 'body']);
    expect(parsed.searchParams.get('title')).toBe('A & B? #1');
  });

  it('a title or body can never change the host, path or add parameters', () => {
    const url = new URL(issueUrl('tinyg', 'x&labels=bug&assignees=me', '/../../evil?y=1#z'));
    expect(url.host).toBe('github.com');
    expect(url.pathname).toBe('/synthetos/TinyG/issues/new');
    expect([...url.searchParams.keys()]).toEqual(['title', 'body']);
    expect(url.hash).toBe('');
  });

  it('refuses targets outside the allowlist, and the forum as an issue tracker', () => {
    expect(() => issueUrl('evil' as never, 't', 'b')).toThrow(/not a report target/);
    expect(() => issueUrl('constructor' as never, 't', 'b')).toThrow(/not a report target/);
    expect(() => issueUrl('forum', 't', 'b')).toThrow(/not an issue tracker/);
    expect(forumUrl()).toBe('https://synthetos.com/forum/new/');
  });

  it('routes firmware problems by dialect', () => {
    expect(firmwareTarget('tinyg-en')).toBe('tinyg');
    expect(firmwareTarget('tinyg-440')).toBe('tinyg');
    expect(firmwareTarget('tinyg-449-stock')).toBe('tinyg');
    expect(firmwareTarget('g2core')).toBe('g2core');
    expect(firmwareTarget(null)).toBeNull();
    expect(firmwareTarget('grbl')).toBeNull();
  });
});

describe('redaction: the board id becomes 0X0000-XXX before the preview', () => {
  it('replaces the exact id, any JSON "id" value and any TinyG-shaped id', () => {
    expect(REDACTED_ID).toBe('0X0000-XXX');
    expect(redactText('board SIM-EN-0001 said SIM-EN-0001', ['SIM-EN-0001'])).toBe('board 0X0000-XXX said 0X0000-XXX');
    expect(redactText('{"r":{"id":"2X4D54-KRT"},"f":[3,0,7]}')).toBe('{"r":{"id":"0X0000-XXX"},"f":[3,0,7]}');
    expect(redactText('{"r":{"id" : "anything at all"}}')).toBe('{"r":{"id" : "0X0000-XXX"}}');
    expect(redactText('[id]  device ID   3X3566-EPV')).toBe('[id]  device ID   0X0000-XXX');
  });

  it('leaves other text alone, escapes ids used as patterns, and ignores empty ids', () => {
    expect(redactText('G1 X10 F500 ; xvm 16000', ['', null, undefined])).toBe('G1 X10 F500 ; xvm 16000');
    expect(redactText('a.b+c a-b-c', ['a.b+c'])).toBe('0X0000-XXX a-b-c');
  });

  it('redacts values deeply, and an "id" member whatever its contents', () => {
    expect(redactValue({ board: { id: 'whatever', fb: 450.01 }, notes: ['SIM-EN-0001'] }, ['SIM-EN-0001'])).toEqual({ board: { id: REDACTED_ID, fb: 450.01 }, notes: [REDACTED_ID] });
  });

  it('the transcript excerpt decodes the hex and redacts the id answer', () => {
    const jsonl = [
      JSON.stringify({ t: 1000, dir: 'tx', hex: hex('{"id":null}\n') }),
      JSON.stringify({ t: 1012, dir: 'rx', hex: hex('{"r":{"id":"SIM-EN-0001"},"f":[3,0,4]}\n') }),
      'not json',
    ].join('\n');
    const t = transcriptExcerpt(jsonl, ['SIM-EN-0001']);
    expect(t.lines).toBe(2);
    expect(t.text).toBe('+0.000 → {"id":null}\n+0.012 ← {"r":{"id":"0X0000-XXX"},"f":[3,0,4]}');
    expect(t.text).not.toContain('SIM-EN');
  });

  it('keeps only the last 200 transcript lines', () => {
    const rows = Array.from({ length: 450 }, (_, i) => JSON.stringify({ t: i, dir: 'rx', hex: hex(`line ${i}\n`) })).join('\n');
    const t = transcriptExcerpt(rows);
    expect(t.lines).toBe(200);
    expect(t.total).toBe(450);
    expect(t.text.split('\n')[0]).toContain('line 250');
  });
});

describe('composing the issue: under about 8 kB, cut with a note', () => {
  const base: ComposeInput = { summary: { title: 'The preview froze', happened: 'It stopped drawing.', steps: '1. Open\n2. Scrub', expected: 'It keeps drawing.' }, items: [{ title: 'Environment', text: 'run version: 0.0.0', fence: 'text' }], version: 'v0.0.0 (0123456789ab)' };

  it('puts the user’s words first and the diagnostics in a collapsed details block', () => {
    const link = issueLink('run', base);
    expect(link.truncated).toBe(false);
    expect(link.body).toMatch(/^### What happened\n\nIt stopped drawing\.\n\n### Steps to reproduce/);
    expect(link.body).toContain('<details>\n<summary>Diagnostics from run</summary>');
    expect(link.body).toContain('#### Environment\n```text\nrun version: 0.0.0\n```');
    expect(new URL(link.url).searchParams.get('body')).toBe(link.body);
  });

  it('truncates long diagnostics to fit the budget, says so, and never leaves a code fence open', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `+${i}.000 ← {"r":{"xvm":16000},"f":[3,0,4]}`).join('\n');
    const link = issueLink('tinyg', { ...base, items: [...base.items, { title: 'Recent transcript', text: big, fence: 'text' }] });
    expect(link.truncated).toBe(true);
    expect(link.url.length).toBeLessThanOrEqual(URL_BUDGET);
    expect(link.url.length).toBeGreaterThan(URL_BUDGET - 400);
    expect(link.body).toContain(TRUNCATION_NOTE);
    expect((link.body.match(/^```/gm) ?? []).length % 2).toBe(0);
    expect(link.body.trimEnd().endsWith('drag them into this issue._')).toBe(true);
    // Copy report is never cut.
    expect(reportMarkdown({ ...base, items: [{ title: 'Recent transcript', text: big, fence: 'text' }] })).toContain(big);
  });

  it('cuts even the user’s own text when it alone is too long', () => {
    const link = issueLink('run', { ...base, summary: { ...base.summary, happened: 'é'.repeat(9000) } });
    expect(link.truncated).toBe(true);
    expect(link.url.length).toBeLessThanOrEqual(URL_BUDGET);
    expect(link.body).toContain(TRUNCATION_NOTE);
  });

  it('cutDiagnostics closes the fence it cut into, on a line boundary', () => {
    const d = '#### A\n```text\nline one\nline two\nline three\n```';
    const cut = cutDiagnostics(d, 30);
    expect(cut).toBe('#### A\n```text\nline one\n…\n```\n\n' + TRUNCATION_NOTE);
    expect(cutDiagnostics(d, 1000)).toBe(d);
  });

  it('uses a longer fence when the text holds a fence', () => {
    const link = issueLink('run', { ...base, items: [{ title: 'G-code', text: '(```)\nG0 X1', fence: 'gcode' }] });
    expect(link.body).toContain('````gcode\n(```)\nG0 X1\n````');
  });
});

describe('collected items and the G-code consent', () => {
  const file = { name: 'bracket for ACME.nc', bytes: enc.encode(Array.from({ length: 120 }, (_, i) => (i === 0 ? '(customer ACME, part 42)' : `G1 X${i} ; pass ${i}`)).join('\n')) };
  const input = (extra: Partial<ItemsInput> = {}): ItemsInput => ({
    environment: { version: '0.0.0', sha: '0'.repeat(40), channel: 'release', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', view: 'run', snapshot: null },
    snapshot: null,
    event: null,
    transcript: null,
    settings: {},
    file,
    line: 60,
    gcodeScope: DEFAULT_GCODE_SCOPE,
    ...extra,
  });

  it('the consent question and its buttons are exactly the design’s, and the excerpt is the default', () => {
    expect(GCODE_CONSENT).toEqual({ question: 'Upload the whole G-code file to this issue? Issues are public: anyone can read and download it.', whole: 'Upload the whole file', excerpt: 'Only 25 lines around the problem' });
    expect(DEFAULT_GCODE_SCOPE).toBe('excerpt');
  });

  it('by default the G-code is the ±25-line excerpt, in the body and in the report files', () => {
    const g = reportItems(input()).find((i) => i.id === 'gcode');
    expect(g?.defaultOn).toBe(true);
    expect(g?.text.split('\n')).toHaveLength(51);
    expect(g?.text).toMatch(/^35 {2}G1 X34/);
    expect(g?.text).toContain('60> G1 X59');
    expect(g?.file?.name).toBe('bracket_for_ACME-lines-35-85.txt');
  });

  it('the whole file goes only into the report files, and only when chosen', () => {
    const g = reportItems(input({ gcodeScope: 'whole' })).find((i) => i.id === 'gcode');
    expect(g?.text.split('\n')).toHaveLength(51);
    expect(g?.file?.name).toBe('bracket_for_ACME.nc');
    expect(String(g?.file?.data).split('\n')).toHaveLength(120);
    expect(g?.note).toContain('the whole file is in the report files');
  });

  it('shows the file name and every comment in what would be posted', () => {
    const excerpt = gcodeFacts(file, 60, 'excerpt');
    expect(excerpt?.name).toBe('bracket for ACME.nc');
    expect(excerpt?.comments).not.toContain('customer ACME, part 42');
    expect(excerpt?.comments).toContain('pass 59');
    expect(gcodeFacts(file, 60, 'whole')?.comments[0]).toBe('customer ACME, part 42');
  });

  it('settings are off by default; items without data are unavailable and never included', () => {
    const items = reportItems(input({ settings: { xvm: 16000 } }));
    const included = defaultIncluded(items);
    expect(included).toEqual({ environment: true, board: false, event: false, transcript: false, settings: false, gcode: true });
    expect(composedItems(items, included).map((i) => i.title)).toEqual(['Environment', 'G-code']);
    expect(composedItems(items, { ...included, board: true }).map((i) => i.title)).toEqual(['Environment', 'G-code']);
  });

  it('the environment is coarse: browser family and major version, never the user-agent string', () => {
    const env = reportItems(input()).find((i) => i.id === 'environment')?.text ?? '';
    expect(env).toContain('browser: Chrome 140 on macOS');
    expect(env).not.toContain('Mozilla');
    expect(env).not.toContain('AppleWebKit');
    expect(browserFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe('Edge 141 on Windows');
    expect(browserFamily('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('Firefox 140 on Linux');
    expect(environmentText({ version: '1.0.0', sha: 'abc', channel: 'bench', userAgent: '', view: 'board', snapshot: { base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'] } })).toContain('session: CONNECTED_UNKNOWN (READ_ONLY)');
  });

  it('board facts name the pin match and redact the id', () => {
    const snapshot = { identity: { fb: 450.02, fv: 0.97, hp: 1, hv: 8, id: 'SIM-EN-0001' }, classification: { dialectId: 'tinyg-en', mode: 'readOnly', reason: 'en-not-approved', detail: '', upgradeOffer: false } } as never;
    const board = reportItems(input({ snapshot })).find((i) => i.id === 'board');
    expect(board?.available).toBe(true);
    expect(board?.text).toContain('board id: 0X0000-XXX');
    expect(board?.text).toContain("fb 450.02, matches run's edge-next pin a7489b79");
    expect(board?.text).not.toContain('SIM-EN');
    expect(pinText('tinyg-440', 440.2)).toContain("differs from run's master 440.xx pin");
  });

  it('the excerpt clamps at the ends of the file and works without a line', () => {
    const text = 'a\nb\nc\n';
    expect(gcodeExcerpt(text, 2)).toMatchObject({ from: 1, to: 3, total: 3, line: 2 });
    expect(gcodeExcerpt(text, null)).toMatchObject({ from: 1, to: 3, line: null });
    expect(gcodeExcerpt(text, 99).line).toBe(3);
    expect(gcodeComments('G0 (a) ;b\n(a)')).toEqual(['a', 'b']);
  });
});

describe('notices that start a report', () => {
  const s = (extra: Record<string, unknown>) => ({ base: 'CONNECTED_UNKNOWN', overlays: [], fault: null, live: {}, ...extra }) as never;

  it('settings reset to defaults at start-up (status 118) is a notice that names them, below a fault', () => {
    const n = eventNotice(s({ notices: { adviseEstop: false, settingsDefaulted: { text: 'Settings restored to defaults - xvm, yvm', at: 1 } } }));
    expect(n).toMatchObject({ kind: 'settings-defaulted', title: 'Some saved settings were reset to their defaults.', event: { code: 'STATUS 118' } });
    expect(n?.detail).toContain('at start-up: xvm, yvm.');
    expect(n?.detail).toContain('Board, All settings');
    expect(eventNotice(s({ overlays: ['FAULT'], fault: { cause: 'writeFailed', kind: 'integrity', detail: 'x', at: 1 }, notices: { adviseEstop: false, settingsDefaulted: { text: 't', at: 1 } } }))?.kind).toBe('fault');
  });

  it('fault, unexpected response, ORPHANED_MOTION and an alarm each have a notice with the event context', () => {
    expect(eventNotice(s({}))).toBeNull();
    expect(eventNotice(null)).toBeNull();
    const unexpected = eventNotice(s({ overlays: ['FAULT'], fault: { cause: 'unexpectedResponse', kind: 'integrity', detail: 'r without a request', at: 1 }, live: { line: 12, stat: 5 } }));
    expect(unexpected?.kind).toBe('unexpected-response');
    expect(unexpected?.event).toMatchObject({ code: 'FAULT unexpectedResponse', state: 'CONNECTED_UNKNOWN', overlays: ['FAULT'], line: 12, stat: 5 });
    expect(eventNotice(s({ overlays: ['FAULT'], fault: { cause: 'bannerAfterReady', kind: 'integrity', detail: 'banner', at: 1 } }))?.kind).toBe('fault');
    expect(eventNotice(s({ overlays: ['ORPHANED_MOTION'] }))?.event.code).toBe('ORPHANED_MOTION');
    expect(eventNotice(s({ live: { machineClass: 'alarm' } }))?.event.code).toBe('ALARM alarm');
    expect(eventNotice(s({ base: 'NOT_CONNECTED', overlays: ['FAULT'] }))).toBeNull();
  });

  it('openReport starts a fresh request every time', () => {
    openReport({ origin: 'menu' });
    const a = reportRequest.value;
    openReport({ origin: 'menu' });
    expect(reportRequest.value?.seq).not.toBe(a?.seq);
  });
});

describe('the store-only zip', () => {
  it('CRC-32 matches the reference value', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes stored entries a reader can list and extract', () => {
    const zip = makeZip([
      { name: 'report.md', data: '# hi\n', date: new Date(2026, 10, 2, 12, 30, 10) },
      { name: '../../etc/x.txt', data: new Uint8Array([1, 2, 3]) },
    ]);
    const view = new DataView(zip.buffer);
    const eocd = zip.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(2);
    const cd = view.getUint32(eocd + 16, true);
    const entries: { name: string; data: Uint8Array }[] = [];
    let at = cd;
    for (let i = 0; i < 2; i++) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      expect(view.getUint16(at + 10, true)).toBe(0);
      const size = view.getUint32(at + 20, true);
      const nameLen = view.getUint16(at + 28, true);
      const local = view.getUint32(at + 42, true);
      const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      const localName = view.getUint16(local + 26, true);
      const data = zip.subarray(local + 30 + localName, local + 30 + localName + size);
      expect(crc32(data)).toBe(view.getUint32(at + 16, true));
      entries.push({ name, data });
      at += 46 + nameLen;
    }
    expect(entries.map((e) => e.name)).toEqual(['report.md', 'etc/x.txt']);
    expect(new TextDecoder().decode(entries[0]?.data)).toBe('# hi\n');
    expect([...(entries[1]?.data ?? [])]).toEqual([1, 2, 3]);
  });

  it('names stay inside the archive', () => {
    expect(zipName('/abs/../x')).toBe('abs/x');
    expect(zipName('..')).toBe('file');
    expect(zipName('a\\b.txt')).toBe('a/b.txt');
  });
});
