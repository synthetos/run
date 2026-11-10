/**
 * H91: the terminal's translator. Every typed line takes the path of the button that does the same thing, or is
 * refused with a plain reason and what to do instead. Nothing here sends.
 */
import { describe, expect, it } from 'vitest';
import { readDecisionFor } from '@synthetos/schema';
import { JOB_STREAMING, NOT_CLASSIFIED } from '../src/console/translate.ts';
import { TERMINAL_TEXT, classify, type TerminalContext } from '../src/terminal/translate.ts';

const ctx: TerminalContext = {
  readDecision: (t) => readDecisionFor('tinyg-en', t),
  jobStreaming: false,
  dialect: 'tinyg-en',
  readable: ['xvm', 'xfr', 'yvm', 'sr', 'g54'],
  activeSystem: 1,
  feedInEffect: false,
};
const c = (input: string, over: Partial<TerminalContext> = {}) => classify(input, { ...ctx, ...over });

describe('reads take the console path', () => {
  it('$xvm, xvm, ? and JSON reads', () => {
    expect(c('$xvm')).toEqual({ kind: 'read', token: 'xvm', wire: '{"xvm":null}' });
    expect(c('xvm')).toEqual({ kind: 'read', token: 'xvm', wire: '{"xvm":null}' });
    expect(c('?')).toEqual({ kind: 'read', token: 'sr', wire: '{"sr":null}' });
    expect(c('{"xvm":null}')).toEqual({ kind: 'read', token: 'xvm', wire: '{"xvm":null}' });
  });

  it('not classified yet, or a job streaming: refused with the console words', () => {
    expect(c('xvm', { readDecision: null })).toMatchObject({ kind: 'refused', reason: NOT_CLASSIFIED });
    expect(c('xvm', { jobStreaming: true })).toMatchObject({ kind: 'refused', reason: JOB_STREAMING });
  });

  it('text-mode commands keep their reasons', () => {
    expect(c('$$')).toMatchObject({ kind: 'refused', reason: expect.stringContaining('$$ lists every setting') });
  });
});

describe('moves take the typed-move path', () => {
  it('G0..G4 lines become a move in canonical form', () => {
    expect(c('g0x10')).toEqual({ kind: 'move', line: 'G0 X10' });
    expect(c('G91 G1 X2 F600')).toEqual({ kind: 'move', line: 'G91 G1 X2 F600' });
    expect(c('G2 X10 Y0 I5 J0 F300')).toEqual({ kind: 'move', line: 'G2 X10 Y0 I5 J0 F300' });
    expect(c('G4 P1')).toEqual({ kind: 'move', line: 'G4 P1' });
    expect(c('g0 x10 (to the left)')).toEqual({ kind: 'move', line: 'G0 X10' });
    expect(c('{"gc":"G0X5"}')).toEqual({ kind: 'move', line: 'G0 X5' });
  });

  it('G1, G2 or G3 without a feed and none in effect: "Add a feed, e.g. F500."', () => {
    expect(c('G1 X10')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.noFeedWhy, remedy: 'Add a feed, e.g. F500.' });
    expect(c('G1 X10', { feedInEffect: true })).toEqual({ kind: 'move', line: 'G1 X10' });
  });

  it('a move the grammar refuses keeps the grammar reason', () => {
    expect(c('G0 G1 X1')).toMatchObject({ kind: 'refused', reason: 'Only one of G0, G1, G2, G3 or G4 per line.' });
    expect(c('G2 X1 F100')).toMatchObject({ kind: 'refused', reason: 'An arc needs either I, J or K, or R.' });
  });

  it('a job streaming: nothing typed moves', () => {
    expect(c('G0 X1', { jobStreaming: true })).toMatchObject({ kind: 'refused', reason: JOB_STREAMING });
  });

  it('modes, feeds and axes alone are refused with how to write the move', () => {
    expect(c('G91')).toEqual({ kind: 'refused', reason: `G91 ${TERMINAL_TEXT.modeAlone}`, remedy: TERMINAL_TEXT.modeHow });
    expect(c('G90 X1')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.noMotion, remedy: TERMINAL_TEXT.noMotionHow });
    expect(c('F500')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.feedAlone, remedy: TERMINAL_TEXT.feedHow });
    expect(c('X10')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.noMotion, remedy: TERMINAL_TEXT.noMotionHow });
  });
});

describe('spindle and coolant take the buttons path', () => {
  it('M3/M4 with a speed: the Spindle button with C24; M5 off', () => {
    expect(c('M3 S12000')).toEqual({ kind: 'spindle', command: { op: 'spindleOn', direction: 'cw', rpm: 12000 }, confirm: 'C24', line: 'M3 S12000' });
    expect(c('m4s500')).toMatchObject({ kind: 'spindle', command: { op: 'spindleOn', direction: 'ccw', rpm: 500 } });
    expect(c('M5')).toEqual({ kind: 'spindle', command: { op: 'spindleOff' }, confirm: null, line: 'M5' });
  });

  it('M3 without a speed, out of range, or with other words: refused', () => {
    expect(c('M3')).toEqual({ kind: 'refused', reason: 'M3 needs a speed.', remedy: TERMINAL_TEXT.speed });
    expect(c('M3 S0')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.speedRange, remedy: TERMINAL_TEXT.speed });
    // The upper bound is the session's, as for the button.
    expect(c('M3 S200000')).toMatchObject({ kind: 'spindle', command: { rpm: 200000 } });
    expect(c('M3 S1.5')).toMatchObject({ reason: TERMINAL_TEXT.speedRange });
    expect(c('M3 S100 X1')).toMatchObject({ reason: 'M3 needs a speed.' });
    expect(c('M5 S1')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.oneCommand, remedy: 'Type M5 alone.' });
  });

  it('M7, M8 on and M9 off: the Coolant buttons, no confirmation', () => {
    expect(c('M7')).toEqual({ kind: 'coolant', command: { op: 'coolantOn', which: 'mist' }, confirm: null, line: 'M7' });
    expect(c('M8')).toMatchObject({ command: { op: 'coolantOn', which: 'flood' } });
    expect(c('M9')).toEqual({ kind: 'coolant', command: { op: 'coolantOff' }, confirm: null, line: 'M9' });
  });

  it('M codes that are not buttons are refused with the reason', () => {
    expect(c('M6')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.toolChangeWhy, remedy: 'Use the tool change button.' });
    expect(c('T2')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.toolChangeWhy, remedy: 'Use the tool change button.' });
    expect(c('M0')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.programStop, remedy: TERMINAL_TEXT.asJob });
    expect(c('M1')).toMatchObject({ reason: TERMINAL_TEXT.programStop });
    expect(c('M2')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.programEnd, remedy: TERMINAL_TEXT.asJob });
    expect(c('M30')).toMatchObject({ reason: TERMINAL_TEXT.programEnd });
    expect(c('M100')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.mHigh, remedy: TERMINAL_TEXT.asJob });
    expect(c('M50')).toEqual({ kind: 'refused', reason: 'M50 is not sent from here.', remedy: TERMINAL_TEXT.asJob });
    expect(c('G0 X1 M3 S100')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.oneCommand, remedy: TERMINAL_TEXT.oneCommandHow });
    expect(c('M7 M8')).toMatchObject({ reason: TERMINAL_TEXT.oneCommand });
  });
});

describe('offsets, zero and homing take the buttons path', () => {
  it('G10 L20 in the active system with axes at 0: Set zero with C16', () => {
    expect(c('G10 L20 P1 X0 Y0')).toEqual({ kind: 'offset', command: { op: 'setZero', axes: ['x', 'y'] }, confirm: 'C16', line: 'G10 L20 P1 X0 Y0' });
    expect(c('G10 L20 P0 Z0')).toMatchObject({ command: { op: 'setZero', axes: ['z'] } });
  });

  it('G10 refusals: L2, another system, no system known, values other than 0, no L', () => {
    expect(c('G10 L2 P1 X5')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.g10l2, remedy: TERMINAL_TEXT.g10How });
    expect(c('G10 L20 P2 X0')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.otherSystem, remedy: 'Type G55 first, or use P1.' });
    expect(c('G10 L20 P1 X0', { activeSystem: null })).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.noSystem, remedy: TERMINAL_TEXT.noSystemHow });
    expect(c('G10 L20 P1 X5')).toEqual({ kind: 'refused', reason: `G10 L20 ${TERMINAL_TEXT.zeroOnly}`, remedy: TERMINAL_TEXT.zeroHow });
    expect(c('G10 L20 P1 B0')).toMatchObject({ reason: `G10 L20 ${TERMINAL_TEXT.zeroOnly}` });
    expect(c('G10 L20 P1 X0 X0')).toMatchObject({ reason: `G10 L20 ${TERMINAL_TEXT.zeroOnly}` });
    expect(c('G10 P1 X0')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.g10Form, remedy: TERMINAL_TEXT.g10How });
    expect(c('G10 L20 X0')).toMatchObject({ reason: TERMINAL_TEXT.g10Form });
  });

  it('G92, G92.1, G28.3, G28.2 and G54..G59: their buttons and confirmations', () => {
    expect(c('G92 X0 Y0')).toEqual({ kind: 'offset', command: { op: 'tempOffset', axes: ['x', 'y'] }, confirm: 'C27', line: 'G92 X0 Y0' });
    expect(c('G92.1')).toEqual({ kind: 'offset', command: { op: 'clearTempOffset' }, confirm: 'C28', line: 'G92.1' });
    expect(c('G28.3 Z0')).toEqual({ kind: 'offset', command: { op: 'setPosition', axes: ['z'] }, confirm: 'C26', line: 'G28.3 Z0' });
    expect(c('G28.2 X0 Y0 Z0')).toEqual({ kind: 'home', command: { op: 'home', axes: ['x', 'y', 'z'] }, confirm: 'C4', line: 'G28.2 X0 Y0 Z0' });
    expect(c('G55')).toEqual({ kind: 'offset', command: { op: 'selectCoord', system: 2 }, confirm: 'C29', line: 'G55' });
  });

  it('their refusals: no axes, values other than 0, stored positions, other G codes', () => {
    expect(c('G28.2')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.axesNeeded, remedy: TERMINAL_TEXT.axesHow });
    expect(c('G92 X5')).toEqual({ kind: 'refused', reason: `G92 ${TERMINAL_TEXT.zeroOnly}`, remedy: TERMINAL_TEXT.zeroHow });
    expect(c('G28')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.storedPosition, remedy: TERMINAL_TEXT.storedHow });
    expect(c('G30 Z0')).toMatchObject({ reason: TERMINAL_TEXT.storedPosition });
    expect(c('G38.2 Z-5')).toEqual({ kind: 'refused', reason: 'G38.2 is not sent from here.', remedy: TERMINAL_TEXT.asJob });
    expect(c('G55 X0')).toMatchObject({ kind: 'refused', reason: TERMINAL_TEXT.noMotion });
    expect(c('G92.1 X0')).toMatchObject({ kind: 'refused', reason: 'G92.1 is not sent from here.' });
  });
});

describe('realtime characters press the real handlers', () => {
  it('! pauses, ~ resumes, % and Ctrl-X stop the job', () => {
    expect(c('!')).toEqual({ kind: 'realtime', action: 'pause' });
    expect(c('!!')).toEqual({ kind: 'realtime', action: 'pause' });
    expect(c('~')).toEqual({ kind: 'realtime', action: 'resume' });
    expect(c('%')).toEqual({ kind: 'realtime', action: 'stop' });
    expect(c('\u0018')).toEqual({ kind: 'realtime', action: 'stop' });
    expect(c('Ctrl-X')).toEqual({ kind: 'realtime', action: 'stop' });
    expect(c('^X')).toEqual({ kind: 'realtime', action: 'stop' });
    // Realtime keys work even while a job streams.
    expect(classify('!', { ...ctx, jobStreaming: true })).toEqual({ kind: 'realtime', action: 'pause' });
  });
});

describe('everything else is refused with a plain reason', () => {
  it('empty, too long, non-ASCII, a paste', () => {
    expect(c('   ')).toEqual({ kind: 'empty' });
    expect(c('x'.repeat(300))).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.tooLong, remedy: TERMINAL_TEXT.shorten });
    expect(c('G0 X1 é')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.notAscii, remedy: TERMINAL_TEXT.plain });
    expect(c('G0 X1\nG0 X2\n')).toEqual({ kind: 'paste', lines: ['G0 X1', 'G0 X2'] });
    expect(c('G0 X1\n')).toEqual({ kind: 'move', line: 'G0 X1' });
  });

  it('settings writes: H61 forbidden writes say why; others point to Pending changes', () => {
    expect(c('$ej=1')).toEqual({ kind: 'refused', reason: '$ej is never written from here: switches JSON/text mode; run speaks JSON only.', remedy: TERMINAL_TEXT.settingsHow });
    expect(c('$xvm=5000')).toEqual({ kind: 'refused', reason: TERMINAL_TEXT.settingsWhy, remedy: TERMINAL_TEXT.settingsHow });
    expect(c('$ej=1', { dialect: null })).toMatchObject({ reason: TERMINAL_TEXT.settingsWhy });
    expect(c('$ej=1', { dialect: 'other' })).toMatchObject({ reason: TERMINAL_TEXT.settingsWhy });
  });

  it('typo help: an unknown word gets the nearest move or setting, never allowlist words', () => {
    expect(c('gt0x10')).toEqual({ kind: 'refused', reason: "`gt0x10` isn't a command or setting on this board.", remedy: 'Did you mean `g0x10`?' });
    expect(c('xvn')).toEqual({ kind: 'refused', reason: "`xvn` isn't a command or setting on this board.", remedy: 'Did you mean `xvm`?' });
    expect(c('qqqqqq')).toEqual({ kind: 'refused', reason: "`qqqqqq` isn't a command or setting on this board.", remedy: 'Press Tab to see what is.' });
    for (const r of [c('gt0x10'), c('xvn')]) expect(JSON.stringify(r)).not.toMatch(/allowlist/i);
  });

  it('other console refusals pass through', () => {
    expect(c('{"a":1,"b":2}')).toMatchObject({ kind: 'refused', reason: expect.stringContaining('one request at a time') });
  });
});
