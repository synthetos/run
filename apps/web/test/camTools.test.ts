/**
 * The tools a file's comments describe (tool-mismatch, 2026-11-10), on header lines from real files (the SolidCraft
 * docklight housing, CamBam's corpus file) and the shapes the Fusion, Carbide Create, Vectric and Estlcam posts write.
 */
import { describe, expect, it } from 'vitest';
import { commentsOf, fileTools, fileToolsFromLines } from '../src/gcode-worker/camTools.ts';
import { lineSpans } from '../src/gcode-worker/lines.ts';
import { DOCKLIGHT } from './docklightSample.ts';


describe('fileToolsFromLines', () => {
  it('SolidCraft (the docklight file): T1 a 6 mm flat end mill, T2 a 3 mm one; the first description of T1 wins', () => {
    expect(fileToolsFromLines(DOCKLIGHT)).toEqual([
      { number: 1, diameterMm: 6, type: 'flat', text: 'Boss top: T1 D6 flat end mill', line: 3 },
      { number: 2, diameterMm: 3, type: 'flat', text: 'O-ring groove: T2 D3 flat end mill', line: 16 },
    ]);
  });

  it('Fusion: D= in the file units, CR= makes a ball or a bull-nose, TAPER= a chamfer angle', () => {
    const mm = fileToolsFromLines([
      '%',
      '(1001)',
      '(T1 D=6 CR=0 - ZMIN=-5 - flat end mill)',
      '(T2 D=3.175 CR=1.5875 - ZMIN=-3 - ball end mill)',
      '(T3 D=12 CR=1 - ZMIN=-4 - bull nose end mill)',
      '(T4 D=10 CR=0 TAPER=45deg - ZMIN=-1 - chamfer mill)',
      'G90 G94 G17',
      'G21',
    ]);
    expect(mm.map((t) => [t.number, t.diameterMm, t.type])).toEqual([[1, 6, 'flat'], [2, 3.175, 'ball'], [3, 12, 'bull-nose'], [4, 10, 'chamfer']]);
    expect(mm[2]?.cornerRadiusMm).toBe(1);
    expect(mm[3]?.vAngle).toBe(90);
    // An inch file: the header's bare D= is inches.
    const inch = fileToolsFromLines(['(T1 D=0.25 CR=0 - ZMIN=-0.2 - flat end mill)', 'G90 G94 G17', 'G20']);
    expect(inch[0]).toMatchObject({ number: 1, diameterMm: 6.35, type: 'flat' });
  });

  it('Carbide Create: TOOL/MILL takes its T number from the tool change after it', () => {
    const tools = fileToolsFromLines(['(Design File: plaque.c2d)', 'G90', 'G21', '(TOOL/MILL,6.35,0.00,0.00,0.00)', 'M6T102', '(TOOL/MILL,6.35,0.00,0.00,90.00)', 'M6T301', '(TOOL/MILL,3.175,1.5875,0.00,0.00)', 'T201 M6']);
    expect(tools.map((t) => [t.number, t.diameterMm, t.type, t.vAngle])).toEqual([[102, 6.35, 'flat', undefined], [201, 3.175, 'ball', undefined], [301, 6.35, 'v-bit', 90]]);
  });

  it('Vectric (brackets inside the comment, fractions) and Estlcam-style semicolon comments', () => {
    const tools = fileToolsFromLines(['( Tools: )', '( T1 : End Mill (6 mm) )', '(T2 : Ball Nose (1/8"))', '(T3 : 60° V-Bit (1/2"))', ';T4: 6mm Flat End Mill', '; T5: 3.175 mm O-flute', 'G21']);
    expect(tools.map((t) => [t.number, t.diameterMm, t.type])).toEqual([[1, 6, 'flat'], [2, 3.175, 'ball'], [3, 12.7, 'v-bit'], [4, 6, 'flat'], [5, 3.175, 'o-flute']]);
    expect(tools[2]?.vAngle).toBe(60);
  });

  it('the operation’s name never sets the type when the description names one', () => {
    expect(fileToolsFromLines(['G21', '(Drill holes: T3 D2 flat end mill)', '(Ball pocket: T4 D6)'])).toEqual([
      { number: 3, diameterMm: 2, type: 'flat', text: 'Drill holes: T3 D2 flat end mill', line: 2 },
      { number: 4, diameterMm: 6, type: 'ball', text: 'Ball pocket: T4 D6', line: 3 },
    ]);
  });

  it('a comment on a tool change line uses that line’s T number', () => {
    expect(fileToolsFromLines(['G21', 'M6 T3 (6mm end mill)'])).toEqual([{ number: 3, diameterMm: 6, type: 'flat', text: '6mm end mill', line: 2 }]);
  });

  it('CamBam’s bare diameter is in the file’s units; a misread size or a heading with no tool facts is not a tool', () => {
    // Alien_Face.nc (gcode differential corpus): T0 is 0.001 in, far below any real cutter.
    expect(fileToolsFromLines(['( This file was created automatically using CamBam )', '( T0 : 0.001 )', 'G20', 'G90', 'M06 T0'])).toEqual([]);
    expect(fileToolsFromLines(['G20', '( T1 : 0.125 )'])).toEqual([{ number: 1, diameterMm: 3.175, type: null, text: 'T1 : 0.125', line: 2 }]);
    expect(fileToolsFromLines(['(2 Adaptive - T1)', '(Created 2026-11-10T12:30)', 'T1 M6', 'G1 X6 Y6 (move to 6mm)'])).toEqual([]);
  });
});

describe('commentsOf and the worker pass', () => {
  it('reads the outermost brackets and a semicolon comment', () => {
    expect(commentsOf('( T1 : End Mill (6 mm) )')).toEqual(['T1 : End Mill (6 mm)']);
    expect(commentsOf('G0 X1 ; T2: 3mm drill')).toEqual(['T2: 3mm drill']);
    expect(commentsOf('G0 X1')).toEqual([]);
  });

  it('fileTools over file bytes gives the same tools as the lines', () => {
    const bytes = new TextEncoder().encode(`${DOCKLIGHT.join('\r\n')}\r\n`);
    expect(fileTools(bytes, lineSpans(bytes))).toEqual(fileToolsFromLines(DOCKLIGHT));
  });
});
