import type { DialectJobGcode } from '@synthetos/protocol';
import {
  type Plane
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import type { Wcs } from '../types.ts';
import { type ModelContext } from './context.ts';
import { block, type Finding } from './contract.ts';
import { AXIS_LETTERS, GROUP, MOTION_CODES } from './tables.ts';

export function checkToolWords(ctx: ModelContext, { params, findings, job, has }: CheckToolWordsInput): { F: Word | undefined; toolChange: boolean; S: Word | undefined; T: Word | undefined } {


  const F = params.get('F');
  const S = params.get('S');
  const T = params.get('T');
  if (F !== undefined && F.value < 0) findings.push(block('negative-feed', 'a negative feed rate is an error (NIST 3.7, E154)'));
  if (S !== undefined && S.value < 0) findings.push(block('negative-speed', 'a negative spindle speed is an error (NIST 3.7, E154)'));
  if (T !== undefined && (!Number.isInteger(T.value) || T.value < 0 || T.value > job.maxTool)) {
    findings.push(block('bad-tool', `T must be a whole number from 0 to ${job.maxTool}; other values select another tool (E154)`));
  }
  const toolChange = has('M6');
  if (toolChange && ctx._options.c14 !== true) {
    const tool = T !== undefined && Number.isInteger(T.value) && T.value >= 0 ? ` (T${String(T.value)})` : '';
    // Phase 3 (SAFETY §4.4a, H74): M6 does not pause on TinyG (it only stores the tool number), so run stops the
    // stream before the line, turns the spindle and coolant off, and walks the user through the change.
    if (ctx._manualToolChange) findings.push({ severity: 'info', rule: 'tool-change-stop', message: `Tool change${tool}: Run stops here for a manual tool change.` });
    else findings.push(block('m6-without-c14', `Tool change${tool}: TinyG doesn't stop for M6, and Run streams jobs only to edge-next, which it stops before each tool change.`));
  }
  return { F, toolChange, S, T };
}

export function candidateUnits(ctx: ModelContext, { has }: CandidateUnitsInput): { units: "G20" | "G21" | null; distance: "G90" | "G91" | null; plane: "G17" | "G18" | "G19" | null; arcDistance: "G90.1" | "G91.1" | null } {


  // The modal state this line runs under (modal codes apply before the block's action, EN execution order).
  const units = has('G20') ? 'G20' : has('G21') ? 'G21' : ctx.units;
  const distance = has('G90') ? 'G90' : has('G91') ? 'G91' : ctx.distance;
  const arcDistance = has('G90.1') ? 'G90.1' : has('G91.1') ? 'G91.1' : ctx.arcDistance;
  const plane: Plane | null = has('G17') ? 'G17' : has('G18') ? 'G18' : has('G19') ? 'G19' : ctx.plane;
  return { units, distance, plane, arcDistance };
}

export function candidateMotion(ctx: ModelContext, { codes, has, words, params }: CandidateMotionInput): { isArcMove: boolean; axisWords: Word[]; action: string | undefined; explicitMotion: "G0" | "G1" | "G2" | "G3" | undefined; g53: boolean; motionMode: "G0" | "G1" | "G2" | "G3" | "G80" | null; toolSet: boolean; arcWords: string[]; isLinearMove: boolean; toolCancel: boolean; wcs: Wcs | null } {

  const explicitMotion = codes.find((c) => MOTION_CODES.has(c.code))?.code as 'G0' | 'G1' | 'G2' | 'G3' | undefined;
  const motionMode = explicitMotion ?? (has('G80') ? 'G80' : ctx.motionMode);
  const wcs = (codes.find((c) => GROUP[c.code] === 'wcs')?.code as Wcs | undefined) ?? ctx.wcs;
  const action = codes.find((c) => GROUP[c.code] === 'action')?.code;
  const g53 = has('G53');
  const toolSet = has('G43.1');
  const toolCancel = has('G49') && ctx._hasToolOffset;
  const { isArcMove, axisWords, arcWords, isLinearMove } = candidateMoves({ words, params, action, toolSet, motionMode });
  return { isArcMove, axisWords, action, explicitMotion, g53, motionMode, toolSet, arcWords, isLinearMove, toolCancel, wcs };
}

export function candidateMoves({ words, params, action, toolSet, motionMode }: CandidateMovesInput): { isArcMove: boolean; axisWords: Word[]; arcWords: string[]; isLinearMove: boolean } {

  const axisWords = words.filter((w) => AXIS_LETTERS.has(w.letter));
  const arcWords = ['I', 'J', 'K', 'R'].filter((l) => params.has(l));
  const isArcMove =
    action === undefined && !toolSet && (motionMode === 'G2' || motionMode === 'G3') && (axisWords.length > 0 || arcWords.length > 0);
  const isLinearMove = action === undefined && !toolSet && (motionMode === 'G0' || motionMode === 'G1') && axisWords.length > 0;
  return { isArcMove, axisWords, arcWords, isLinearMove };
}

interface CheckToolWordsInput {
  params: Map<string, Word>;
  findings: Finding[];
  job: DialectJobGcode;
  has: (code: string) => boolean
}

interface CandidateUnitsInput {
  has: (code: string) => boolean
}

interface CandidateMotionInput {
  codes: { word: Word; code: string; }[];
  has: (code: string) => boolean;
  words: readonly Word[];
  params: Map<string, Word>
}

interface CandidateMovesInput {
  words: readonly Word[];
  params: Map<string, Word>;
  action: string | undefined;
  toolSet: boolean;
  motionMode: "G0" | "G1" | "G2" | "G3" | "G80" | null
}
