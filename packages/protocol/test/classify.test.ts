import { describe, expect, it } from 'vitest';
import { MAX_TID, READY_MESSAGE, checksum440, classifyLine, parseFooter } from '../src/classify.ts';
import type { ClassifiedLine } from '../src/types.ts';

/** Append a correct revision-1 checksum: `prefix` ends with the comma before it. */
function withChecksum(prefix: string, tail: string): string {
  return `${prefix}${checksum440(`${prefix}0`)}${tail}`;
}

function garbledReason(line: string): string | undefined {
  const c = classifyLine(line);
  return c.kind === 'Garbled' ? c.reason : `not Garbled: ${c.kind}`;
}

describe('classify: Response', () => {
  it('extracts r, the footer and its placement', () => {
    const line = '{"r":{"stat":5},"f":[2,0,14]}';
    expect(classifyLine(line)).toEqual({
      kind: 'Response',
      line,
      r: { stat: 5 },
      footer: { rev: 2, status: 0, field3: 14, raw: [2, 0, 14] },
      footerPlacement: 'top',
    });
  });

  it('parses footer revisions 1 (TG, with checksum; g2, without), 2 and 3 into {rev, status, field3}', () => {
    const cases: [string, object][] = [
      ['{"r":{"fb":440.20},"f":[1,0,12,1645]}', { rev: 1, status: 0, field3: 12, checksum: 1645 }],
      ['{"r":{},"f":[1,0,20]}', { rev: 1, status: 0, field3: 20 }],
      ['{"r":{},"f":[2,7,40000]}', { rev: 2, status: 7, field3: 40000 }],
      ['{"r":{"fb":449.01},"f":[3,0,11]}', { rev: 3, status: 0, field3: 11 }],
    ];
    for (const [line, footer] of cases) {
      const c = classifyLine(line);
      expect(c.kind, line).toBe('Response');
      expect(c.kind === 'Response' && c.footer, line).toMatchObject(footer);
    }
  });

  it('reads a footer nested in r (TG fd=1) and removes it from the body', () => {
    const line = withChecksum('{"r":{"gc":"G28.2X0Y0","f":[1,0,21,', ']}}');
    const c = classifyLine(line);
    expect(c).toMatchObject({ kind: 'Response', footerPlacement: 'nested', footer: { rev: 1, field3: 21 } });
    expect(c.kind === 'Response' && Object.keys(c.r)).toEqual(['gc']);
  });

  it('extracts a top-level tid (EN, PN §5.3), and only a top-level one', () => {
    expect(classifyLine('{"r":{"fb":449.01},"tid":33,"f":[3,0,11]}')).toMatchObject({ kind: 'Response', tid: 33 });
    expect(classifyLine(`{"r":{},"tid":${MAX_TID},"f":[3,0,11]}`)).toMatchObject({ tid: 0xffffffff });
    expect(classifyLine('{"r":{},"tid":0,"f":[3,0,11]}')).toMatchObject({ tid: 0 });
    const nested = classifyLine('{"r":{"tid":7},"f":[3,0,11]}');
    expect(nested.kind).toBe('Response');
    expect('tid' in nested).toBe(false);
  });

  it('refuses a tid that is not an unsigned 32-bit integer (EN would never print one)', () => {
    for (const tid of ['42.5', '-1', '"42"', '4294967296', 'null', 'true', '1e300']) {
      expect(garbledReason(`{"r":{},"tid":${tid},"f":[3,0,11]}`), tid).toBe('bad-tid');
    }
  });

  it('refuses responses with no footer, two footers, or a footer that is not a valid revision', () => {
    expect(garbledReason('{"r":{"sr":{"stat":1}}}')).toBe('bad-footer');
    expect(garbledReason('{"r":{"f":[3,0,11]},"f":[3,0,11]}')).toBe('bad-footer');
    for (const f of ['[]', '[3,0]', '[3,0,11,0]', '[2,0,1,2]', '[1,0]', '[1,0,1,2,3]', '[4,0,11]', '[0,0,11]',
      '[3,-1,11]', '[3,0,1.5]', '[3,"0",11]', '[1,0,9,-1]', '[1,0,9,"x"]', '"3,0,11"', '{"rev":3}', 'null']) {
      expect(garbledReason(`{"r":{},"f":${f}}`), f).toBe('bad-footer');
    }
  });

  it('refuses a revision-1 line whose checksum does not match (one changed digit)', () => {
    expect(classifyLine('{"r":{"fb":440.20},"f":[1,0,12,1645]}').kind).toBe('Response');
    expect(garbledReason('{"r":{"fb":440.30},"f":[1,0,12,1645]}')).toBe('checksum-mismatch');
    expect(garbledReason('{"r":{"fb":440.20},"f":[1,0,12,1646]}')).toBe('checksum-mismatch');
    expect(garbledReason('{"r":{"fb":440.20},"f":[1,0,13,1645]}')).toBe('checksum-mismatch');
  });

  it('refuses extra top-level keys and a non-object r', () => {
    expect(garbledReason('{"r":{},"f":[3,0,11],"x":1}')).toBe('unrecognized-shape');
    expect(garbledReason('{"r":{},"f":[3,0,11],"sr":{"stat":1}}')).toBe('unrecognized-shape');
    expect(garbledReason('{"r":5,"f":[3,0,11]}')).toBe('bad-value');
    expect(garbledReason('{"r":null,"f":[3,0,11]}')).toBe('bad-value');
    expect(garbledReason('{"r":[],"f":[3,0,11]}')).toBe('bad-value');
  });

  it('returns frozen events', () => {
    const c = classifyLine('{"r":{"a":{"b":1}},"f":[3,0,11]}');
    expect(Object.isFrozen(c)).toBe(true);
    expect(c.kind === 'Response' && Object.isFrozen(c.footer) && Object.isFrozen(c.r)).toBe(true);
  });
});

describe('classify: Banner (PN §2.2, SAFETY H19)', () => {
  it('classifies the EN bare-sr banner as a Banner, not a status report', () => {
    const line = '{"sr":{"fv":0.97,"fb":449.01,"hp":1,"hv":8,"id":"0BENCH-TWO","msg":"SYSTEM READY"}}';
    expect(classifyLine(line)).toEqual({
      kind: 'Banner',
      line,
      shape: 'bare-sr',
      msg: READY_MESSAGE,
      ready: true,
      fv: 0.97,
      fb: 449.01,
      hp: 1,
      hv: 8,
      id: '0BENCH-TWO',
      fields: { fv: 0.97, fb: 449.01, hp: 1, hv: 8, id: '0BENCH-TWO', msg: 'SYSTEM READY' },
    });
  });

  it('classifies any sr carrying msg as a Banner, even a minimal or odd one (missing a reset is the dangerous error)', () => {
    expect(classifyLine('{sr:{fv:0.970,fb:449.01,msg:"SYSTEM READY"}}')).toMatchObject({ kind: 'Banner', ready: true });
    expect(classifyLine('{"sr":{"msg":"Loading configs from EEPROM"}}')).toMatchObject({ kind: 'Banner', ready: false });
    const odd = classifyLine('{"sr":{"msg":5,"fv":"x","fb":null,"hp":true,"hv":[],"id":7}}');
    expect(odd).toMatchObject({ kind: 'Banner', shape: 'bare-sr', msg: '', ready: false });
    for (const k of ['fv', 'fb', 'hp', 'hv', 'id', 'fbs', 'footer']) expect(k in odd, k).toBe(false);
  });

  it('classifies the TG and g2 r-footer banners, with the footer and string hp/hv', () => {
    const tg = '{"r":{"fv":0.970,"fb":440.20,"hp":1,"hv":8,"id":"0BENCH-ONE","msg":"SYSTEM READY"},"f":[1,0,0,8416]}';
    expect(classifyLine(tg)).toMatchObject({
      kind: 'Banner',
      shape: 'r-footer',
      ready: true,
      fb: 440.2,
      footer: { rev: 1, status: 0, field3: 0, checksum: 8416 },
    });
    const g2 = '{"r":{"fv":0.99,"fb":101.03,"fbs":"101.03-1-g1fb5940","hp":"gQuadratic","hv":"b","id":"x","msg":"SYSTEM READY"},"f":[1,0,10]}';
    expect(classifyLine(g2)).toMatchObject({ kind: 'Banner', hp: 'gQuadratic', hv: 'b', fbs: '101.03-1-g1fb5940' });
  });

  it('treats every boot message as a Banner (ready only for SYSTEM READY), including nested-footer TG builds', () => {
    const init = withChecksum('{"r":{"fb":377.08,"fv":0.950,"hv":7,"id":"9H0000-AAB","msg":"Initializing configs to default settings","f":[1,15,8,', ']}}');
    expect(classifyLine(init)).toMatchObject({ kind: 'Banner', shape: 'r-footer', ready: false, footer: { status: 15 } });
  });

  it('a TG 440.21 banner at jv=1 (msg filtered out) is still a Banner, with ready unknown (TG json_parser.c:490-511)', () => {
    const line = withChecksum('{"r":{"fv":0.970,"fb":440.21,"hp":1,"hv":8,"id":"0BENCH-ONE"},"f":[1,0,0,', ']}');
    expect(classifyLine(line)).toMatchObject({ kind: 'Banner', shape: 'r-footer', msg: '', ready: null, fb: 440.21, id: '0BENCH-ONE' });
    // Not when any key is missing or extra: a single-key GET answer stays a Response.
    expect(classifyLine(withChecksum('{"r":{"fb":440.21},"f":[1,0,12,', ']}')).kind).toBe('Response');
    expect(classifyLine(withChecksum('{"r":{"fv":0.97,"fb":440.21,"hp":1,"hv":8},"f":[1,0,12,', ']}')).kind).toBe('Response');
    expect(classifyLine(withChecksum('{"r":{"fv":0.97,"fb":440.21,"hp":1,"hv":8,"id":"x","ja":2},"f":[1,0,12,', ']}')).kind).toBe('Response');
    // Never with a tid (a banner answers no request).
    expect(garbledReason('{"r":{"fv":0.97,"fb":440.21,"hp":1,"hv":8,"id":"x"},"tid":4,"f":[3,0,12]}')).toBe('unrecognized-shape');
  });

  it('keeps a G-code message response (msg without identity keys) a Response', () => {
    expect(classifyLine('{"r":{"msg":"tool change"},"f":[3,0,11]}').kind).toBe('Response');
  });

  it('refuses an r-footer banner that carries a tid (a banner never answers a request)', () => {
    expect(garbledReason('{"r":{"fb":449.01,"msg":"SYSTEM READY"},"tid":3,"f":[3,0,11]}')).toBe('unrecognized-shape');
  });
});

describe('classify: StatusReport, QueueReport, Exception, Ack', () => {
  it('StatusReport', () => {
    expect(classifyLine('{"sr":{"posx":-0.037,"stat":5}}')).toMatchObject({ kind: 'StatusReport', sr: { posx: -0.037, stat: 5 } });
    expect(classifyLine('{sr:{posx:1.000}}')).toMatchObject({ kind: 'StatusReport' });
    expect(garbledReason('{"sr":null}')).toBe('bad-value');
    expect(garbledReason('{"sr":5}')).toBe('bad-value');
    expect(garbledReason('{"sr":{"stat":1},"x":1}')).toBe('unrecognized-shape');
  });

  it('QueueReport with and without qi/qo, strict and relaxed', () => {
    expect(classifyLine('{"qr":32}')).toEqual({ kind: 'QueueReport', line: '{"qr":32}', qr: 32 });
    expect(classifyLine('{qr:20,qi:3,qo:1}')).toMatchObject({ kind: 'QueueReport', qr: 20, qi: 3, qo: 1 });
    expect(classifyLine('{"qr":20,"qo":1}')).toEqual({ kind: 'QueueReport', line: '{"qr":20,"qo":1}', qr: 20, qo: 1 });
    for (const bad of ['{"qr":null}', '{"qr":-1}', '{"qr":1.5}', '{"qr":1,"qi":"x"}', '{"qr":1,"qo":-2}']) {
      expect(garbledReason(bad), bad).toBe('bad-value');
    }
    expect(garbledReason('{"qr":1,"x":2}')).toBe('unrecognized-shape');
  });

  it('Exception, strict and relaxed, with optional fb and msg', () => {
    expect(classifyLine('{"er":{"fb":449.01,"st":203,"msg":"Limit hit"}}')).toMatchObject({
      kind: 'Exception',
      st: 203,
      msg: 'Limit hit',
      fb: 449.01,
    });
    expect(classifyLine('{er:{fb:440.21,st:204,msg:"Limit switch hit"}}')).toMatchObject({ kind: 'Exception', st: 204 });
    const minimal = classifyLine('{"er":{"st":29}}');
    expect(minimal).toMatchObject({ kind: 'Exception', st: 29, msg: '' });
    expect('fb' in minimal).toBe(false);
    for (const bad of ['{"er":null}', '{"er":{"msg":"x"}}', '{"er":{"st":"204"}}', '{"er":{"st":1,"msg":5}}', '{"er":{"st":1,"fb":"x"}}']) {
      expect(garbledReason(bad), bad).toBe('bad-value');
    }
    expect(garbledReason('{"er":{"st":1},"f":[3,0,11]}')).toBe('unrecognized-shape');
  });

  it('Ack only for {"ack":true}', () => {
    expect(classifyLine('{"ack":true}')).toEqual({ kind: 'Ack', line: '{"ack":true}' });
    expect(classifyLine('{ack:t}')).toMatchObject({ kind: 'Ack' });
    expect(garbledReason('{"ack":false}')).toBe('bad-value');
    expect(garbledReason('{"ack":1}')).toBe('bad-value');
    expect(garbledReason('{"ack":true,"x":1}')).toBe('unrecognized-shape');
  });

  it('RxReport for exactly {"rx":n}, n an unsigned integer up to 255 (TG report.c:541-548, after every %)', () => {
    expect(classifyLine('{"rx":254}')).toEqual({ kind: 'RxReport', line: '{"rx":254}', rx: 254 });
    expect(classifyLine('{rx:0}')).toMatchObject({ kind: 'RxReport', rx: 0 });
    expect(classifyLine('{"rx":255}')).toMatchObject({ kind: 'RxReport', rx: 255 });
    for (const bad of ['{"rx":256}', '{"rx":-1}', '{"rx":1.5}', '{"rx":"254"}', '{"rx":null}', '{"rx":true}']) {
      expect(garbledReason(bad), bad).toBe('bad-value');
    }
    expect(garbledReason('{"rx":254,"qr":32}')).toBe('unrecognized-shape');
    expect(garbledReason('{"rx":254,"x":1}')).toBe('unrecognized-shape');
  });

  it('refuses objects of no known shape, keeping the parsed value', () => {
    const c = classifyLine('{"prb":{"e":1}}');
    expect(c).toEqual({ kind: 'Garbled', reason: 'unrecognized-shape', line: '{"prb":{"e":1}}', value: { prb: { e: 1 } } });
    expect(garbledReason('{}')).toBe('unrecognized-shape');
    expect(garbledReason('{"f":[3,0,11]}')).toBe('unrecognized-shape');
  });
});

describe('classify: Text and damaged lines', () => {
  it('Text for non-JSON lines with no braces', () => {
    for (const t of ['tinyg [mm] ok> ', '[fb]  firmware build            440.20', 'ok', '$$', '\u0000\u0001']) {
      expect(classifyLine(t), t).toEqual({ kind: 'Text', line: t });
    }
  });

  it('Garbled json-fragment for a non-JSON line containing a brace (spliced or damaged output)', () => {
    for (const t of ['posx":1.000}}', '\u0000{"sr":{"stat":4}}', '﻿{}', 'x{', 'sr:{stat:1']) {
      expect(garbledReason(t), t).toBe('json-fragment');
    }
  });

  it('ignores surrounding spaces and tabs for the JSON test, but keeps the line verbatim', () => {
    const line = ' \t{"qr":5}\t ';
    expect(classifyLine(line)).toEqual({ kind: 'QueueReport', line, qr: 5 });
  });

  it('maps parser failures to malformed-json, too-deep and too-large', () => {
    expect(garbledReason('{"r":{"fb":')).toBe('malformed-json');
    expect(garbledReason('{"a":1}[')).toBe('malformed-json');
    expect(garbledReason('{"a":1,"a":2}')).toBe('malformed-json');
    expect(garbledReason(`{"a":${'['.repeat(20)}${']'.repeat(20)}}`)).toBe('too-deep');
    expect(garbledReason(`{"a":"${'x'.repeat(5000)}"}`)).toBe('too-large');
  });

  it('never throws and always returns one of the eight kinds', () => {
    const kinds = new Set(['Response', 'StatusReport', 'QueueReport', 'Exception', 'Banner', 'Ack', 'Text', 'Garbled']);
    const samples = ['', '{', '}', '{"r":', '{"r":{},"f":[3,0,11]', 'null', '{"r":{"f":null}}'];
    for (const s of samples) {
      const c: ClassifiedLine = classifyLine(s);
      expect(kinds.has(c.kind), s).toBe(true);
    }
  });
});

describe('parseFooter and checksum440', () => {
  it('returns undefined for anything that is not a footer', () => {
    expect(parseFooter(undefined)).toBeUndefined();
    expect(parseFooter(null)).toBeUndefined();
    expect(parseFooter([3, 0, 11])).toEqual({ rev: 3, status: 0, field3: 11, raw: [3, 0, 11] });
  });

  it('matches the EN-HIL checksum_440 values captured from a 440.20 board', () => {
    expect(checksum440('{"r":{"fb":440.20},"f":[1,0,12,1645]}')).toBe(1645);
    expect(checksum440('{"r":{},"f":[1,132,5,6965]}')).toBe(6965);
    expect(
      checksum440('{"r":{"fv":0.970,"fb":440.20,"hp":1,"hv":8,"id":"0BENCH-ONE","msg":"SYSTEM READY"},"f":[1,0,0,8416]}'),
    ).toBe(8416);
  });
});
