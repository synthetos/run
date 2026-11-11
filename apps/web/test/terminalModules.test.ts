/**
 * H91: the terminal's small pure modules: typo help, paste detection, history, completion, the transcript, formatting
 * and the move preview.
 */
import { describe, expect, it } from 'vitest';
import { parseTypedLine, type TypedLine } from '@synthetos/safety';
import { CODES, applyCompletion, commonPrefix, completions, lastWord } from '../src/terminal/complete.ts';
import { FIRST_MOVE_NOTICE, KIND_CLASS, SYMBOL, lowZQuestion, sentLine, statusWords, travelQuestion, typedResult, type TravelFinding, type TypedMoveNotice } from '../src/terminal/format.ts';
import { HISTORY_KEY_PREFIX, History } from '../src/terminal/history.ts';
import { asProgram, pastedLines } from '../src/terminal/paste.ts';
import { lineModes, modesLine, movePreview } from '../src/terminal/preview.ts';
import { DEFAULT_FILTER, EMPTY_TRANSCRIPT, append, asText, timeOf, visible } from '../src/terminal/transcript.ts';
import { distance, nearMove, nearSetting, typoHelp } from '../src/terminal/typo.ts';
import type { StorageLike } from '../src/workspace/storage.ts';

function memory(): StorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('typo help', () => {
  it('distance counts inserts, deletes, replacements and swaps', () => {
    expect(distance('xvm', 'xvm')).toBe(0);
    expect(distance('xvn', 'xvm')).toBe(1);
    expect(distance('xmv', 'xvm')).toBe(1);
    expect(distance('', 'ab')).toBe(2);
    expect(distance('abc', '')).toBe(3);
  });

  it('a move one character away: left out or swapped', () => {
    expect(nearMove('gt0x10')).toBe('g0x10');
    expect(nearMove('0gx10')).toBe('g0x10');
    expect(nearMove('hello')).toBeNull();
  });

  it('the nearest setting, at most 2 edits, never for one letter', () => {
    expect(nearSetting('xvn', ['yvm', 'xvm'])).toBe('xvm');
    expect(nearSetting('xv', ['xvm', 'xfr'])).toBe('xvm');
    expect(nearSetting('abcdef', ['xvm'])).toBeNull();
    expect(nearSetting('q', ['x'])).toBeNull();
    // A tie goes to the first name in order.
    expect(nearSetting('ab', ['ac', 'aa'])).toBe('aa');
  });

  it('the words name the word typed and the guess', () => {
    expect(typoHelp('xvn', 'xvn', ['xvm'])).toEqual({ kind: 'refused', reason: "`xvn` isn't a command or setting on this board.", remedy: 'Did you mean `xvm`?' });
    expect(typoHelp('zzzz', 'zzzz', [])).toMatchObject({ remedy: 'Press Tab to see what is.' });
  });
});

describe('paste', () => {
  it('two or more non-blank lines are a paste; one line is not', () => {
    expect(pastedLines('G0 X1\r\nG0 X2\r\n\r\n')).toEqual(['G0 X1', 'G0 X2']);
    expect(pastedLines('G0 X1\rG0 X2')).toEqual(['G0 X1', 'G0 X2']);
    expect(pastedLines('G0 X1\n\n')).toBeNull();
    expect(pastedLines('G0 X1')).toBeNull();
    expect(asProgram(['G0 X1', 'G0 X2'])).toBe('G0 X1\nG0 X2\n');
  });
});

describe('history', () => {
  it('up and down through the lines, the draft given back, no equal lines in a row', () => {
    const h = new History('m1', { storage: memory() });
    h.add('G0 X1');
    h.add('G0 X1');
    h.add('  ');
    h.add('xvm');
    expect(h.lines).toEqual(['G0 X1', 'xvm']);
    expect(h.up('draft')).toBe('xvm');
    expect(h.up('xvm')).toBe('G0 X1');
    expect(h.up('G0 X1')).toBe('G0 X1');
    expect(h.down()).toBe('xvm');
    expect(h.down()).toBe('draft');
    expect(h.down()).toBe('draft');
  });

  it('empty history: up keeps what is typed', () => {
    const h = new History('m1', { storage: memory() });
    expect(h.up('abc')).toBe('abc');
    expect(h.down()).toBe('abc');
  });

  it('per machine, kept in storage, oldest first past the maximum', () => {
    const s = memory();
    const a = new History('a', { storage: s, max: 2 });
    a.add('one');
    a.add('two');
    a.add('three');
    expect(a.lines).toEqual(['two', 'three']);
    expect(JSON.parse(s.data.get(`${HISTORY_KEY_PREFIX}a`) as string)).toEqual(['two', 'three']);
    expect(new History('a', { storage: s }).lines).toEqual(['two', 'three']);
    expect(new History('b', { storage: s }).lines).toEqual([]);
  });

  it('storage that is missing, throws or holds junk: this page only', () => {
    const none = new History('a', { storage: null });
    none.add('x');
    expect(none.saved).toBe(false);
    expect(none.lines).toEqual(['x']);
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    const t = new History('a', { storage: throwing });
    expect(t.lines).toEqual([]);
    t.add('y');
    expect(t.saved).toBe(false);
    const junk = memory();
    junk.setItem(`${HISTORY_KEY_PREFIX}a`, '{"not":"a list"}');
    expect(new History('a', { storage: junk }).lines).toEqual([]);
    junk.setItem(`${HISTORY_KEY_PREFIX}a`, '["ok", 5]');
    expect(new History('a', { storage: junk }).lines).toEqual(['ok']);
    // The default storage is the browser's (absent under the test runner, or present): never throws.
    expect(() => new History('default')).not.toThrow();
  });

  it('Ctrl-R finds the newest match, then older ones', () => {
    const h = new History('m', { storage: memory() });
    for (const l of ['G0 X1', 'xvm', 'G0 X2']) h.add(l);
    const first = h.search('g0');
    expect(first).toEqual({ line: 'G0 X2', index: 2 });
    expect(h.search('g0', first?.index)).toEqual({ line: 'G0 X1', index: 0 });
    expect(h.search('g0', 0)).toBeNull();
    expect(h.search('')).toBeNull();
  });
});

describe('completion', () => {
  it('a G or M word gets the codes it starts, each with a meaning', () => {
    expect(completions('g2', 'tinyg-en').map((c) => c.text)).toEqual(['G2', 'G20', 'G21', 'G28.2', 'G28.3']);
    expect(completions('G0 X1 m', 'tinyg-en').map((c) => c.text)).toEqual(['M3', 'M4', 'M5', 'M7', 'M8', 'M9']);
    expect(CODES.every((c) => c.meaning.length > 0)).toBe(true);
  });

  it('a setting word alone gets this board’s settings; nothing after other words', () => {
    const list = completions('xv', 'tinyg-en');
    expect(list[0]?.text).toBe('xvm');
    expect(list[0]?.meaning.length).toBeGreaterThan(0);
    expect(completions('$xv', 'tinyg-en')[0]?.text).toBe('$xvm');
    expect(completions('G0 xv', 'tinyg-en')).toEqual([]);
    expect(completions('', 'tinyg-en')).toEqual([]);
  });

  it('applies a completion and shares the common prefix', () => {
    expect(lastWord('G0 X1 m')).toBe('m');
    expect(lastWord('G0 ')).toBe('');
    expect(applyCompletion('G0 X1 m', { text: 'M3', meaning: '' })).toBe('G0 X1 M3');
    expect(commonPrefix([{ text: 'G28.2', meaning: '' }, { text: 'G28.3', meaning: '' }])).toBe('G28.');
    expect(commonPrefix([])).toBe('');
  });

  it('a setting with no label uses its description', () => {
    const list = completions('sr', 'tinyg-en');
    expect(list.every((c) => typeof c.meaning === 'string')).toBe(true);
  });
});

describe('transcript', () => {
  it('appends with ids, keeps at most max, filters status and raw', () => {
    let t = EMPTY_TRANSCRIPT;
    t = append(t, { at: 0, kind: 'sent', text: 'G0 X1' });
    t = append(t, { at: 1, kind: 'status', text: 'Idle', raw: '{"sr":{"stat":1}}' });
    t = append(t, { at: 2, kind: 'reply', text: 'xvm: 800', raw: '{"r":{"xvm":800}}' }, 2);
    expect(t.entries.map((e) => e.id)).toEqual([2, 3]);
    expect(visible(t, DEFAULT_FILTER).map((e) => e.text)).toEqual(['xvm: 800']);
    expect(visible(t, { hideStatus: false, raw: true }).map((e) => e.text)).toEqual(['{"sr":{"stat":1}}', '{"r":{"xvm":800}}']);
    expect(asText(t, DEFAULT_FILTER)).toBe(`${timeOf(2)} reply  xvm: 800`);
    expect(timeOf(0)).toMatch(/^\d\d:\d\d:\d\d$/);
  });
});

describe('format', () => {
  const notice = (kind: TypedMoveNotice['kind'], text = 'x'): TypedMoveNotice => ({ kind, line: 'G0 X1', text, at: 0 });

  it('symbols are for the screen only, and each kind has a class', () => {
    expect(Object.values(SYMBOL)).toEqual(['✓', '⚠', '✕', '⏸', '▶']);
    expect(KIND_CLASS.error).toBe('term-error');
    expect(FIRST_MOVE_NOTICE).toBe('Typed moves run straight on the machine. Stop is the red button or Esc.');
  });

  it('status codes in plain words', () => {
    expect(statusWords(0)).toBe('OK');
    expect(statusWords(22)).toBe('Status 22: floating point error.');
    expect(statusWords(9999)).toBe('Status 9999.');
  });

  it('a typed move result as one line', () => {
    expect(typedResult(notice('done', 'Done.'))).toEqual({ symbol: '✓', cls: 'term-note', text: 'G0 X1: Done.' });
    expect(typedResult(notice('confirm', 'Run can’t check…'))).toEqual({ symbol: '⚠', cls: 'term-note', text: 'Run can’t check…' });
    expect(typedResult(notice('stopped', 'Stopped.'))).toEqual({ symbol: '⏸', cls: 'term-error', text: 'G0 X1: Stopped.' });
    expect(typedResult(notice('refused', 'No.'))).toEqual({ symbol: '✕', cls: 'term-error', text: 'G0 X1: No.' });
    expect(sentLine('G0 X1')).toEqual({ symbol: '▶', cls: 'term-sent', text: 'G0 X1' });
  });

  it('the low-Z question (OD-31): Raise only where offered, else why; nothing for another notice', () => {
    const asked = (lowZ: NonNullable<TypedMoveNotice['lowZ']>): TypedMoveNotice => ({ kind: 'lowZ', line: 'G0 X5', text: 'Z is low. Raise Z first?', at: 0, lowZ });
    expect(typedResult(asked({ raise: true, safeZ: 74, z: 1, why: null }))).toMatchObject({ symbol: '⚠', text: 'Z is low. Raise Z first?' });
    expect(lowZQuestion(asked({ raise: true, safeZ: 74, z: 1, why: null }))).toEqual({
      text: 'Z is low. Raise Z first?',
      why: null,
      choices: [
        { choice: 'raise', label: 'Raise to 74 mm' },
        { choice: 'asTyped', label: 'Move as typed' },
        { choice: 'cancel', label: 'Cancel' },
      ],
    });
    expect(lowZQuestion(asked({ raise: true, safeZ: null, z: 1, why: null }))?.choices[0]?.label).toBe('Raise');
    const no = lowZQuestion(asked({ raise: false, safeZ: null, z: 1, why: "Z wasn't homed in this connection." }));
    expect(no?.choices.map((c) => c.choice)).toEqual(['asTyped', 'cancel']);
    expect(no?.why).toBe("Z wasn't homed in this connection.");
    expect(lowZQuestion(notice('done'))).toBeNull();
  });

  it('the travel question: Home, Move anyway, Cancel, and the finding to send back', () => {
    const past: TravelFinding = { kind: 'outside', line: 1, text: 'line 1: X would reach machine 160 mm, beyond its travel limit of 150 mm, and …', past: { axis: 'X', reach: 160, limit: 150, unit: 'mm', more: 0 } };
    const q = travelQuestion(past);
    expect(q.text).toBe("X isn't homed, so Run can't check its travel. X would reach 160 mm, past its 150 mm limit. Move only if you have checked where it is.");
    expect(q.choices.map((c) => c.label)).toEqual(['Home', 'Move anyway', 'Cancel']);
    expect(q.finding).toBe(past.text);
    const unchecked: TravelFinding = { kind: 'unchecked', line: null, text: 'the travel limits of X were not read' };
    expect(travelQuestion(unchecked).text).toBe("Run can't check this move against the travel: the travel limits of X were not read. Move only if you have checked that it fits.");
  });
});

describe('preview', () => {
  const parsed = (line: string): TypedLine => {
    const r = parseTypedLine(line);
    if (!r.ok) throw new Error(r.reason);
    return r.value;
  };
  const MM_ABS = { units: 1, dist: 0, coor: 1 };

  it('the modes in effect, or what was not read', () => {
    expect(modesLine(MM_ABS)).toBe('mm · absolute · G54');
    expect(modesLine({ units: 0, dist: 1, coor: 2 })).toBe('in · relative · G55');
    expect(modesLine({ units: undefined, dist: undefined, coor: undefined })).toBe('(units not read) · distance mode not read · work system not read');
  });

  it('the line’s own modes win over the board’s', () => {
    expect(lineModes(parsed('G20 G91 G55 G0 X1'), MM_ABS)).toEqual({ units: 0, dist: 1, frame: 'G55' });
    expect(lineModes(parsed('G21 G90 G53 G0 X1'), { units: 0, dist: 1, coor: 1 })).toEqual({ units: 1, dist: 0, frame: 'machine coordinates' });
  });

  it('what the move does, in words', () => {
    expect(movePreview(parsed('G1 X10 F500'), MM_ABS)).toBe('Moves X to 10 mm at F500 (absolute, G54)');
    expect(movePreview(parsed('G91 G0 X2 A90'), MM_ABS)).toBe('Rapid: moves X by 2 mm, A by 90 (relative, G54)');
    expect(movePreview(parsed('G2 X1 I1 F100'), MM_ABS)).toBe('Arc clockwise: moves X to 1 mm at F100 (absolute, G54)');
    expect(movePreview(parsed('G3 I1 F100'), { units: undefined, dist: undefined, coor: undefined })).toBe('Arc counter-clockwise: moves in a full circle at F100 (distance mode not read, work system not read)');
    expect(movePreview(parsed('G4 P0.5'), MM_ABS)).toBe('Waits 0.5 s');
  });
});

it('157 names the missing arc centre in plain words', () => {
  expect(statusWords(157)).toBe('Status 157: the arc centre is missing or at its start.');
});
