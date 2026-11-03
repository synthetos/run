/**
 * T-S32 (SAFETY §5, ROADMAP P0-05): every W and C string in strings.ts,
 * rendered with example parameters, matches the in-repo SAFETY.md §5–§6 byte
 * for byte. Rows that SAFETY.md defines as "As OLD-S Cn" are checked against
 * the in-repo copy of OLD-S §6 (docs/safety/OLD-S.md).
 *
 * How a check works: the document's quoted text is taken as is, each
 * placeholder in it (`<machine name>`, the bare `N` in "N s", ...) is replaced
 * by an example value, and the result must equal the function's output for
 * that value. Every case runs with two different example sets, so a function
 * that ignored a parameter (or hard-coded the document's example) fails.
 *
 * Completeness is checked both ways: every W and C id in the document has a
 * case (so a new warning in SAFETY.md fails here until strings.ts has it),
 * every quoted string in the document is consumed by a case, and every
 * string function exported by strings.ts is exercised.
 */
import { describe, expect, it } from 'vitest';
import * as S from '../src/strings.ts';
import { OLD_S_MD, SAFETY_MD, confirmationRows, quotedSegments, warningBlocks } from './safetyDoc.ts';

type Doc = 'S' | 'OLD-S';
type Sub = readonly [token: string, value: string];

interface Case<E> {
  /** Which document holds the text, and the W/C id of its entry there. */
  readonly doc: Doc;
  readonly id: string;
  /** Index of the quoted string within that entry. */
  readonly segment: number;
  /** The strings.ts export(s) this case exercises. */
  readonly exports: readonly (keyof typeof S)[];
  readonly examples: readonly [E, E];
  readonly render: (example: E) => string;
  /** Placeholder → value, applied in order. */
  readonly subs: (example: E) => readonly Sub[];
}

// One untyped case list keeps the table readable; each `c()` call is checked
// against its own example type.
const cases: Case<never>[] = [];
function c<E>(spec: Case<E>): void {
  cases.push(spec as unknown as Case<never>);
}
const none = (): readonly Sub[] => [];
const noExamples = [undefined, undefined] as const;

/** A bare placeholder word, such as `N` or `T`, not part of a longer word. */
function bareWord(token: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${token}(?![\\p{L}\\p{N}_])`, 'gu');
}

/** The document text with each placeholder replaced; every placeholder must occur. */
function substitute(textInDoc: string, subs: readonly Sub[]): string {
  let out = textInDoc;
  for (const [token, value] of subs) {
    if (/^[A-Z]$/.test(token)) {
      const re = bareWord(token);
      if (!re.test(out)) throw new Error(`placeholder ${token} does not occur in ${JSON.stringify(out)}`);
      out = out.replace(bareWord(token), value);
    } else {
      if (!out.includes(token)) throw new Error(`placeholder ${token} does not occur in ${JSON.stringify(out)}`);
      out = out.split(token).join(value);
    }
  }
  return out;
}

const docs: Record<Doc, { warnings: Map<string, string>; confirmations: Map<string, string> }> = {
  S: { warnings: warningBlocks(SAFETY_MD), confirmations: confirmationRows(SAFETY_MD) },
  'OLD-S': { warnings: new Map(), confirmations: confirmationRows(OLD_S_MD) },
};

function entry(doc: Doc, id: string): string {
  const found = (id.startsWith('W') ? docs[doc].warnings : docs[doc].confirmations).get(id);
  if (found === undefined) throw new Error(`${doc} has no entry ${id}`);
  return found;
}

function segmentOf(doc: Doc, id: string, index: number): string {
  const segment = quotedSegments(entry(doc, id))[index];
  if (segment === undefined) throw new Error(`${doc} ${id} has no quoted string #${index}`);
  return segment;
}

// ---------------------------------------------------------------- §5

const fixed = (id: string, exp: keyof typeof S, render: () => string, segment = 0): void =>
  c({ doc: 'S', id, segment, exports: [exp], examples: noExamples, render, subs: none });

fixed('W1', 'w1', S.w1);
fixed('W2', 'w2Label', S.w2Label, 0);
fixed('W2', 'w2Tooltip', S.w2Tooltip, 1);
fixed('W3', 'w3', S.w3, 1);
c({
  doc: 'S', id: 'W4', segment: 0, exports: ['w4'],
  examples: [{ seconds: 3 }, { seconds: 12.5 }],
  render: S.w4,
  subs: (e) => [['N', String(e.seconds)]],
});
c({
  doc: 'S', id: 'W5', segment: 0, exports: ['w5'],
  examples: [{ distanceMm: 38, seconds: 4 }, { distanceMm: 7.5, seconds: 1.2 }],
  render: S.w5,
  subs: (e) => [['N', String(e.distanceMm)], ['T', String(e.seconds)]],
});
c({
  doc: 'S', id: 'W5-HB', segment: 0, exports: ['w5Hb'],
  examples: [{ seconds: 2 }, { seconds: 0.5 }],
  render: S.w5Hb,
  subs: (e) => [['T', String(e.seconds)]],
});
fixed('W6', 'w6', S.w6);
fixed('W7', 'w7', S.w7);
c({
  doc: 'S', id: 'W8', segment: 0, exports: ['w8'],
  examples: [
    { machineName: 'Shop router', boardId: '2U29-1234', firmware: 'edge-next 450.00', port: 'USB serial 1' },
    { machineName: 'Mill', boardId: 'X', firmware: '440.21', port: 'COM3' },
  ],
  render: S.w8,
  subs: (e) => [['<machine name>', e.machineName], ['<board id>', e.boardId], ['<firmware>', e.firmware], ['<port>', e.port]],
});
c({
  doc: 'S', id: 'W9', segment: 0, exports: ['w9'],
  examples: [{ axis: 'X' }, { axis: 'Z' }],
  render: S.w9,
  subs: (e) => [['<X>', e.axis]],
});
fixed('W10', 'w10', S.w10);
fixed('W11', 'w11', S.w11);
fixed('W12', 'w12', S.w12, 1);
fixed('W13', 'w13', S.w13);
fixed('W14', 'w14Watermark', S.w14Watermark, 0);
fixed('W14', 'w14Footer', S.w14Footer, 1);
fixed('W15', 'w15', () => S.w15({ dialect: 'TG' }), 0);
fixed('W15', 'w15', () => S.w15({ dialect: 'EN' }), 1);
fixed('W16', 'w16', S.w16);
fixed('W17', 'w17', S.w17);
fixed('W18', 'w18', S.w18);
fixed('W19', 'w19', S.w19);
fixed('W20', 'w20', S.w20);
fixed('W21', 'w21', S.w21);
fixed('W22', 'w22', S.w22);
c({
  doc: 'S', id: 'W23', segment: 0, exports: ['w23'],
  examples: [
    { machineName: 'Shop router', fromRevision: 4, toRevision: 5, device: 'Chrome on Windows', date: '2026-11-01' },
    { machineName: 'Mill', fromRevision: 0, toRevision: 12, device: 'Edge on macOS', date: '1 Nov 2026' },
  ],
  render: S.w23,
  subs: (e) => [['<machine name>', e.machineName], ['<a>', String(e.fromRevision)], ['<b>', String(e.toRevision)], ['<device>', e.device], ['<date>', e.date]],
});
for (const kind of ['profile', 'file'] as const) {
  c({
    doc: 'S', id: 'W24', segment: 0, exports: ['w24'],
    examples: [{ kind, device: 'Chrome on Linux', date: '2026-10-30' }, { kind, device: 'Edge', date: 'yesterday' }],
    render: S.w24,
    subs: (e) => [['<profile | file>', e.kind], ['<device>', e.device], ['<date>', e.date]],
  });
}
for (const [advice, words] of [['upgrade', 'Upgrade to the approved TinyG firmware'], ['usual-sender', 'Use your usual sender']] as const) {
  c({
    doc: 'S', id: 'W25', segment: 0, exports: ['w25'],
    examples: [{ fb: '449.01', reason: 'stock edge-0.97', advice }, { fb: '100.26', reason: 'unknown build', advice }],
    render: S.w25,
    subs: (e) => [['<fb>', e.fb], ['<reason>', e.reason], ['<Upgrade to the approved TinyG firmware | Use your usual sender>', words]],
  });
}
fixed('W26', 'w26', S.w26);
fixed('W27', 'w27', S.w27);
fixed('W28', 'w28', S.w28);
fixed('W29', 'w29', S.w29);
fixed('W30', 'w30', S.w30);
c({
  doc: 'S', id: 'W31', segment: 0, exports: ['w31'],
  examples: [{ seconds: 60 }, { seconds: 9 }],
  render: S.w31,
  subs: (e) => [['N', String(e.seconds)]],
});
fixed('W32', 'w32', S.w32);
c({
  doc: 'S', id: 'W33', segment: 1, exports: ['w33'],
  examples: [{ cause: 'no status for 2 s', seconds: 10 }, { cause: 'worker stopped', seconds: 3 }],
  render: S.w33,
  subs: (e) => [['<cause>', e.cause], ['N', String(e.seconds)]],
});
fixed('W34', 'w34', S.w34);
fixed('W35', 'w35', S.w35);
c({
  doc: 'S', id: 'W36', segment: 0, exports: ['w36'],
  examples: [{ setting: 'sv', from: 0, to: 1 }, { setting: 'si', from: 5000, to: 250 }],
  render: S.w36,
  subs: (e) => [['<setting>', e.setting], ['<old>', String(e.from)], ['<new>', String(e.to)]],
});

// ---------------------------------------------------------------- §6

const fixedC = (doc: Doc, id: string, exp: keyof typeof S, render: () => string, segment = 0): void =>
  c({ doc, id, segment, exports: [exp], examples: noExamples, render, subs: none });

fixedC('S', 'C1', 'c1Full', () => S.renderChecklist(S.c1Full()), 0);
fixedC('S', 'C1', 'c1Short', () => S.renderChecklist(S.c1Short()), 1);
c({
  doc: 'OLD-S', id: 'C3', segment: 0, exports: ['c3'],
  examples: [
    { axis: 'X', distanceMm: 0.25, feedMmPerMin: 100, expectedSteps: 320 },
    { axis: 'Z', distanceMm: -0.25, feedMmPerMin: 50, expectedSteps: 160 },
  ],
  render: S.c3,
  subs: (e) => [['<X>', e.axis], ['<+0.25>', e.distanceMm > 0 ? `+${e.distanceMm}` : String(e.distanceMm)], ['<F>', String(e.feedMmPerMin)], ['<steps>', String(e.expectedSteps)]],
});
// OLD-S C3 also gives the rendering at the TinyG defaults (sa 1.8°, mi 8, tr 1.25): 0.25 × 200 × 8 / 1.25 = 320.
fixedC('OLD-S', 'C3', 'c3', () => S.c3({ axis: 'X', distanceMm: 0.25, feedMmPerMin: 100, expectedSteps: (0.25 * (360 / 1.8) * 8) / 1.25 }), 1);
c({
  doc: 'S', id: 'C4', segment: 0, exports: ['c4'],
  examples: [{ axes: 'X, Y and Z', searchMm: 312 }, { axes: 'Z', searchMm: 45.5 }],
  render: S.c4,
  subs: (e) => [['<axes>', e.axes], ['<N>', String(e.searchMm)]],
});
c({
  doc: 'OLD-S', id: 'C4', segment: 0, exports: ['c4TemporaryCap'],
  examples: [{ searchMm: 20, travelMin: -5, travelMax: 15 }, { searchMm: 8, travelMin: 0, travelMax: 8 }],
  render: S.c4TemporaryCap,
  subs: (e) => [['<N>', String(e.searchMm)], ['<tn>', String(e.travelMin)], ['<tm>', String(e.travelMax)]],
});
c({
  doc: 'S', id: 'C5', segment: 0, exports: ['c5'],
  examples: [
    { settings: 3, machineName: 'Shop router', boardId: '2U29', changes: 'xvm 16000 → 12000', highRisk: ['1po 0 → 1'] },
    { settings: 12, machineName: 'Mill', boardId: 'B7', changes: '(table)', highRisk: ['xsn', 'ysn'] },
  ],
  render: S.c5,
  subs: (e) => [['N', String(e.settings)], ['<machine name>', e.machineName], ['<board id>', e.boardId], ['<table>', e.changes], ['<list>', e.highRisk.join(', ')]],
});
fixedC('OLD-S', 'C6', 'c6Boxes', () => S.renderChecklist({ boxes: S.c6Boxes().boxes.slice(0, 7) }), 0);
fixedC('S', 'C6', 'c6Boxes', () => S.renderChecklist({ boxes: S.c6Boxes().boxes.slice(7) }), 0);
c({
  doc: 'S', id: 'C6', segment: 1, exports: ['c6Question'],
  examples: [
    { boardId: '2U29', fromBuild: '440.21', toBuild: '450.00', sha256Short: 'c2c1…5e92' },
    { boardId: 'B7', fromBuild: '449.01', toBuild: '440.21', sha256Short: 'ab12…ff00' },
  ],
  render: S.c6Question,
  subs: (e) => [['<id>', e.boardId], ['<old>', e.fromBuild], ['<new>', e.toBuild], ['<short>', e.sha256Short]],
});
type C7 = Parameters<typeof S.c7>[0];
const c7a: C7 = {
  file: 'sign.nc', sha256Short: '9f2c…01ab', state: 'NEW', lines: 1520, units: 'mm', wcs: 'G54',
  x: { min: 0, max: 120 }, y: { min: -5, max: 80.5 }, zMin: -3.2, spindleRpm: 12000, estimated: '14 min',
  overrunMm: 38, overrunSeconds: 4, longestLineSeconds: 5, splitMoves: 2, wakeLock: 'ON',
};
const c7b: C7 = {
  ...c7a, file: 'part 2.gcode', state: 'CHANGED', lines: 7, units: 'inch', wcs: 'G55',
  x: { min: -1, max: 1 }, y: { min: 2, max: 3 }, zMin: 0, spindleRpm: 8000, estimated: '40 s',
  overrunMm: 3.5, overrunSeconds: 1, longestLineSeconds: 2, splitMoves: 0, wakeLock: 'OFF',
};
c({
  doc: 'S', id: 'C7', segment: 0, exports: ['c7'],
  examples: [c7a, c7b],
  render: (e) => S.renderChecklist(S.c7(e)),
  // SAFETY §6 writes the Y range as "Y …" ("as for X") and shows example
  // values for units, WCS and the spindle; those are replaced like placeholders.
  subs: (e) => [
    ['<file>', e.file], ['<short>', e.sha256Short], ['<state SAME/NEW/CHANGED>', e.state], ['N', String(e.lines)],
    ['units mm', `units ${e.units}`], ['WCS G54', `WCS ${e.wcs}`], ['<min..max>', `${e.x.min}..${e.x.max}`],
    ['Y …', `Y ${e.y.min}..${e.y.max}`], ['<z>', String(e.zMin)], ['spindle ON S<rpm>', `spindle ON S${String(e.spindleRpm)}`],
    ['<t>', e.estimated], ['<mm>', String(e.overrunMm)], ['<s>', String(e.overrunSeconds)], ['<c>', String(e.longestLineSeconds)],
    ['<k>', String(e.splitMoves)], ['<ON>', e.wakeLock],
  ],
});
c({
  doc: 'S', id: 'C8', segment: 0, exports: ['c8'],
  examples: [{ file: 'sign.nc' }, { file: 'part 2.gcode' }],
  render: S.c8,
  subs: (e) => [['<file>', e.file]],
});
c({
  doc: 'OLD-S', id: 'C9', segment: 0, exports: ['c9'],
  examples: [{ line: 418, spindle: 'UNCONFIRMED' }, { line: 0, spindle: 'ON (reported)' }],
  render: S.c9,
  subs: (e) => [['<N>', String(e.line)], ['<reported state or UNCONFIRMED>', e.spindle]],
});
c({
  doc: 'OLD-S', id: 'C9', segment: 1, exports: ['c9SpindleRestart'],
  examples: [{ direction: 'M3', rpm: 12000, spinUpSeconds: 4 }, { direction: 'M4', rpm: 500, spinUpSeconds: 1.5 }],
  render: S.c9SpindleRestart,
  subs: (e) => [['<M3/M4>', e.direction], ['<rpm>', String(e.rpm)], ['<spin-up>', String(e.spinUpSeconds)]],
});
c({
  doc: 'S', id: 'C10', segment: 0, exports: ['c10'],
  examples: [{ axes: ['X', 'Y'] }, { axes: ['Z'] }],
  render: S.c10,
  subs: (e) => [['X, Y', e.axes.join(', ')]],
});
fixedC('OLD-S', 'C12', 'c12', S.c12, 0);
c({
  doc: 'S', id: 'C13', segment: 0, exports: ['c13'],
  examples: [{ meaning: 'A limit switch was hit' }, { meaning: 'Soft limit exceeded on Y' }],
  render: S.c13,
  subs: (e) => [['<meaning of the alarm code>', e.meaning]],
});
// SAFETY §6 C13: "(EN 207: "The job was stopped. Position is kept; homing is
// recommended.")" replaces the meaning sentence and the homing sentence.
fixedC('S', 'C13', 'c13En207', () => S.c13En207().replace(/^Clear the alarm\? /, ''), 1);
c({
  doc: 'S', id: 'C14', segment: 0, exports: ['c14'],
  examples: [{ toolChanges: 3 }, { toolChanges: 1 }],
  render: S.c14,
  subs: (e) => [['<k>', String(e.toolChanges)]],
});
c({
  doc: 'OLD-S', id: 'C15', segment: 0, exports: ['c15'],
  examples: [{ boardId: '2U29', dialect: 'EN' as const }, { boardId: 'B7', dialect: 'EN' as const }],
  render: S.c15,
  subs: (e) => [['<id>', e.boardId]],
});
c({
  doc: 'S', id: 'C15', segment: 0, exports: ['c15'],
  examples: [{ boardId: '2U29', dialect: 'TG' as const }, { boardId: 'B7', dialect: 'TG' as const }],
  // "TG adds:" the sentence after the OLD-S C15 text.
  render: (e) => S.c15(e).slice(S.c15({ ...e, dialect: 'EN' }).length + 1),
  subs: none,
});
c({
  doc: 'S', id: 'C16', segment: 0, exports: ['c16'],
  examples: [
    { wcs: 'G54', axis: 'X', machinePositionMm: 112.402, newOffsetMm: 112.402 },
    { wcs: 'G55', axis: 'Z', machinePositionMm: -3, newOffsetMm: -3.5 },
  ],
  render: S.c16,
  subs: (e) => [['<G54>', e.wcs], ['<X>', e.axis], ['<mpo>', String(e.machinePositionMm)], ['<value>', String(e.newOffsetMm)]],
});
c({
  doc: 'OLD-S', id: 'C17', segment: 0, exports: ['c17'],
  examples: [{ pending: 'travel on Z', diff: 'ztm 5 → 120' }, { pending: 'reporting settings', diff: 'sv 2 → 1' }],
  render: S.c17,
  subs: (e) => [['<travel on Z, or reporting settings>', e.pending], ['<diff>', e.diff]],
});
c({
  doc: 'S', id: 'C18', segment: 0, exports: ['c18'],
  examples: [{ factoryDefaults: 'xvm 16000, 1po 0' }, { factoryDefaults: 'spep 1' }],
  render: S.c18,
  subs: (e) => [['<key defaults read from the board>', e.factoryDefaults]],
});
c({
  doc: 'S', id: 'C19', segment: 0, exports: ['c19'],
  examples: [
    { profileName: 'Router', revision: 5, machineName: 'Shop router', boardId: '2U29', diff: S.C19_NO_BASELINE, highRisk: ['1po'] },
    { profileName: 'Mill v2', revision: 1, machineName: 'Mill', boardId: 'B7', diff: `xvm 16000 → 12000 (${S.C19_PROVENANCE.elsewhere})`, highRisk: ['xsn', 'zsx'] },
  ],
  render: S.c19,
  subs: (e) => [
    ['<name>', e.profileName], ['<b>', String(e.revision)], ['<machine name>', e.machineName], ['<board id>', e.boardId],
    [
      '<key-level diff against this machine\'s baseline (the last local snapshot or last-applied revision; "No baseline on this computer" if there is none), with provenance per change ("made on this computer" only with a valid device signature, otherwise "made elsewhere")>',
      e.diff,
    ],
    ['<list>', e.highRisk.join(', ')],
  ],
});
c({
  doc: 'S', id: 'C20', segment: 0, exports: ['c20New'],
  examples: [{ machineName: 'Shop router' }, { machineName: 'Mill' }],
  render: S.c20New,
  subs: (e) => [['<machine name>', e.machineName]],
});
c({
  doc: 'S', id: 'C20', segment: 1, exports: ['c20Changed'],
  examples: [
    { name: 'sign.nc', machineName: 'Shop router', when: '2 days ago', device: 'Chrome on Windows', diffSummary: '12 lines changed' },
    { name: 'part', machineName: 'Mill', when: '2026-10-01', device: 'Edge', diffSummary: 'Feed rates changed' },
  ],
  render: S.c20Changed,
  subs: (e) => [['<name>', e.name], ['<machine name>', e.machineName], ['<when>', e.when], ['<device>', e.device], ['<diff summary>', e.diffSummary]],
});
fixedC('S', 'C21', 'c21', S.c21, 0);
c({
  doc: 'S', id: 'C22', segment: 0, exports: ['c22'],
  examples: [{ spindle: 'on, S12000', coolant: 'on' }, { spindle: 'off', coolant: 'on (M8)' }],
  render: S.c22,
  subs: (e) => [['<on, S…>', e.spindle], ['<on>', e.coolant]],
});
c({
  doc: 'S', id: 'C23', segment: 0, exports: ['c23'],
  examples: [{ machineName: 'Shop router', boardId: '2U29', revision: 6 }, { machineName: 'Mill', boardId: 'B7', revision: 1 }],
  render: S.c23,
  subs: (e) => [['<machine name>', e.machineName], ['<board id>', e.boardId], ['<n+1>', String(e.revision)]],
});
c({
  doc: 'S', id: 'C24', segment: 0, exports: ['c24'],
  examples: [{ direction: 'CW' as const, rpm: 12000 }, { direction: 'CCW' as const, rpm: 800 }],
  render: S.c24,
  subs: (e) => [['<direction>', e.direction], ['<rpm>', String(e.rpm)]],
});
c({
  doc: 'S', id: 'C25', segment: 0, exports: ['c25'],
  examples: [
    { axes: 'X, Y and Z', path: 'Z up to machine 0 mm, then X and Y to 0, then Z to 0' },
    { axes: 'Z', path: 'Z to 0' },
  ],
  render: S.c25,
  subs: (e) => [['<axes>', e.axes], ['<path>', e.path]],
});
c({
  doc: 'S', id: 'C26', segment: 0, exports: ['c26'],
  examples: [{ axes: 'X, Y and Z' }, { axes: 'Z' }],
  render: S.c26,
  subs: (e) => [['<axes>', e.axes]],
});
c({
  doc: 'S', id: 'C27', segment: 0, exports: ['c27'],
  examples: [{ axes: 'X and Y', system: 'G54' }, { axes: 'Z', system: 'G57' }],
  render: S.c27,
  subs: (e) => [['<axes>', e.axes], ['<system>', e.system]],
});
c({
  doc: 'S', id: 'C28', segment: 0, exports: ['c28'],
  examples: [{ system: 'G54' }, { system: 'G59' }],
  render: S.c28,
  subs: (e) => [['<system>', e.system]],
});
c({
  doc: 'S', id: 'C29', segment: 0, exports: ['c29'],
  examples: [{ system: 'G55' }, { system: 'G58' }],
  render: S.c29,
  subs: (e) => [['<system>', e.system]],
});

/**
 * Quoted strings in the document that are not user-facing text: an ARIA
 * role, and the words typed for a typed confirmation (checked against
 * TYPED_WORDS below).
 */
const NOT_TEXT: ReadonlyMap<string, readonly number[]> = new Map([
  ['S:W3', [0]],
  ['S:W12', [0]],
  ['S:W33', [0]],
  ['S:C5', [1]],
  ['S:C19', [1]],
  ['OLD-S:C12', [1]],
  // OLD-S C6's final question ("... to 440.21 (sha256 c2c1…5e92)?") is
  // replaced by SAFETY §6 C6's "... to <new> (sha256 <short>)?".
  ['OLD-S:C6', [1]],
]);

/** §6 rows SAFETY.md defines by reference to OLD-S; their text is checked there. */
const AS_OLD_S = ['C3', 'C9', 'C12', 'C15', 'C17'];
/** Retired ids, never reused. */
const RETIRED = ['C2', 'C11'];

describe('T-S32: strings.ts matches SAFETY §5–§6 byte for byte', () => {
  for (const [index, spec] of cases.entries()) {
    it(`${spec.doc} ${spec.id} #${spec.segment} = ${spec.exports.join(', ')} (case ${index})`, () => {
      const inDoc = segmentOf(spec.doc, spec.id, spec.segment);
      const seen = new Set<string>();
      for (const example of spec.examples) {
        const rendered = spec.render(example);
        expect(rendered).toBe(substitute(inDoc, spec.subs(example)));
        seen.add(rendered);
      }
      // Two different example sets must give two different texts, unless the
      // string has no parameters.
      if (spec.subs(spec.examples[0]).length > 0) expect(seen.size).toBe(2);
    });
  }

  it('every warning in §5 has a case', () => {
    const covered = new Set(cases.filter((k) => k.doc === 'S').map((k) => k.id));
    const ids = [...docs.S.warnings.keys()];
    expect(ids.length).toBeGreaterThanOrEqual(34);
    expect(ids.filter((id) => !covered.has(id))).toEqual([]);
  });

  it('every confirmation in §6 has a case, except retired ids; "As OLD-S" rows are checked against OLD-S', () => {
    const ids = [...docs.S.confirmations.keys()];
    expect(ids.length).toBeGreaterThanOrEqual(23);
    for (const id of RETIRED) expect(entry('S', id)).toMatch(/Retired/);
    for (const id of AS_OLD_S) {
      expect(entry('S', id), id).toContain(`As OLD-S ${id}`);
      expect(cases.some((k) => k.doc === 'OLD-S' && k.id === id), id).toBe(true);
    }
    const covered = new Set(cases.map((k) => k.id));
    expect(ids.filter((id) => !RETIRED.includes(id) && !covered.has(id))).toEqual([]);
  });

  it('every quoted string of every covered entry is consumed by a case', () => {
    const entries = new Set(cases.map((k) => `${k.doc}:${k.id}`));
    for (const key of entries) {
      const [doc, id] = key.split(':') as [Doc, string];
      const segments = quotedSegments(entry(doc, id));
      const consumed = new Set([...cases.filter((k) => k.doc === doc && k.id === id).map((k) => k.segment), ...(NOT_TEXT.get(key) ?? [])]);
      expect(segments.map((_, i) => i).filter((i) => !consumed.has(i)), key).toEqual([]);
    }
  });

  it('the typed words are the ones §6 names', () => {
    expect(segmentOf('S', 'C5', 1)).toBe(S.TYPED_WORDS.write);
    expect(segmentOf('S', 'C19', 1)).toBe(S.TYPED_WORDS.write);
    expect(segmentOf('OLD-S', 'C12', 1)).toBe(S.TYPED_WORDS.background);
    expect(entry('S', 'C12')).toContain(`Typed "${S.TYPED_WORDS.background}"`);
    expect(entry('S', 'C10')).toContain(`Type ${S.TYPED_WORDS.runUnhomed} to continue`);
    expect(entry('S', 'C18')).toContain(`Type ${S.TYPED_WORDS.leaveWithoutRestore} to continue`);
    expect(entry('S', 'C21')).toContain(`Type ${S.TYPED_WORDS.noWakeLock} to start anyway`);
  });

  it('the C19 diff labels are the ones §6 quotes', () => {
    const row = entry('S', 'C19');
    expect(row).toContain(`"${S.C19_NO_BASELINE}"`);
    expect(row).toContain(`"${S.C19_PROVENANCE.thisComputer}"`);
    expect(row).toContain(`"${S.C19_PROVENANCE.elsewhere}"`);
  });

  it('every string function exported by strings.ts is exercised', () => {
    const helpers = new Set(['renderChecklist', 'SafetyStringError']);
    const exported = Object.entries(S)
      .filter(([name, value]) => typeof value === 'function' && !helpers.has(name))
      .map(([name]) => name);
    const exercised = new Set(cases.flatMap((k) => k.exports as readonly string[]));
    expect(exported.filter((name) => !exercised.has(name))).toEqual([]);
  });
});

describe('the T-S32 check itself', () => {
  it('fails on a one-character difference', () => {
    const inDoc = segmentOf('S', 'W1', 0);
    expect(S.w1()).toBe(inDoc);
    expect(S.w1().replace('E-stop', 'E stop')).not.toBe(inDoc);
  });

  it('refuses a placeholder that does not occur in the document text', () => {
    expect(() => substitute('for N s', [['T', '3']])).toThrow(/does not occur/);
    expect(() => substitute('to <machine name>', [['<machine>', 'x']])).toThrow(/does not occur/);
  });

  it('replaces a bare placeholder only as a whole word', () => {
    expect(substitute('NOT CONNECTED for N s', [['N', '7']])).toBe('NOT CONNECTED for 7 s');
  });

  it('notices a new warning added to SAFETY.md', () => {
    // Assembled from parts: a signal-word literal is allowed only in strings.ts.
    const newWarning = ['WARNING', '—', 'New.'].join(' ');
    const grown = SAFETY_MD.replace('- **W33 (', `- **W90 (new):** "${newWarning}"\n- **W33 (`);
    const ids = [...warningBlocks(grown).keys()];
    const covered = new Set(cases.filter((k) => k.doc === 'S').map((k) => k.id));
    expect(ids.filter((id) => !covered.has(id))).toEqual(['W90']);
  });
});

describe('STOP_TEXT (P1-06)', () => {
  it('each stop-path text is quoted verbatim in SAFETY.md', () => {
    for (const [key, value] of Object.entries(S.STOP_TEXT)) {
      expect(SAFETY_MD.includes(`"${value}"`), key).toBe(true);
    }
  });
});
