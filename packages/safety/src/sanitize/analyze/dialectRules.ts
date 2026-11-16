import {
  type Plane
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import { type ModelContext } from './context.ts';
import { block, type Finding } from './contract.ts';
import { AXIS_ACTIONS } from './tables.ts';

/** The dialect's modal block rules: G18 arcs, codes under a modal state (SAFETY §4.7 step 6). */
export function checkModalRules(ctx: ModelContext, ...[codes, units, distance, plane, isArc, findings]: [codes: readonly string[], units: string | null, distance: string | null, plane: Plane | null, isArc: boolean, findings: Finding[]]): void {
  for (const rule of ctx._rules) {
    if (rule.kind === 'arcInPlane' && isArc && (plane === rule.plane || plane === null)) {
      findings.push(block(rule.id, plane === null ? `${rule.reason} The active plane is not known.` : rule.reason));
    }
    if (rule.kind === 'codeUnderModal' && codes.some((c) => rule.codes.includes(c))) {
      const modes = [units, distance];
      if (modes.some((m) => m !== null && rule.modes.includes(m)) || modes.includes(null)) {
        findings.push(block(rule.id, modes.includes(null) ? `${rule.reason} The units or distance mode are not known.` : rule.reason));
      }
    }
  }
}

/** TG E088: at most `max` queued commands per line besides motion. */
export function checkQueued(ctx: ModelContext, codes: readonly string[], params: ReadonlyMap<string, Word>, findings: Finding[]): void {
  for (const rule of ctx._rules) {
    if (rule.kind !== 'queuedCommandsPerLine') continue;
    let count = codes.filter((c) => rule.counted.includes(c)).length;
    for (const letter of ['S', 'T']) if (params.has(letter) && rule.counted.includes(letter)) count++;
    if (count > rule.max) findings.push(block(rule.id, rule.reason));
  }
}

export function checkAxisActions(ctx: ModelContext, { codes, units, distance, plane, isArcMove, findings, params, axisWords, action, explicitMotion, g53, motionMode }: CheckAxisActionsInput): void {


  checkModalRules(ctx, codes.map((c) => c.code), units, distance, plane, isArcMove, findings);
  checkQueued(ctx, codes.map((c) => c.code), params, findings);

  if (axisWords.length > 0 && action !== undefined && AXIS_ACTIONS.has(action) && explicitMotion !== undefined) {
    findings.push(block('modal-conflict', `${explicitMotion} and ${action} both use the axis words on this line (E152)`));
  }
  if (g53 && action !== undefined) findings.push(block('modal-conflict', `G53 cannot share a line with ${action} (E152)`));
  if (g53 && action === undefined && motionMode !== 'G0' && motionMode !== 'G1') {
    findings.push(block('modal-conflict', 'G53 needs G0 or G1 in effect (NIST 3.5.12)'));
  }
}

export function checkAxisModeConflicts({ g53, action, distance, findings, axisWords, toolSet, motionMode }: CheckAxisModeConflictsInput): void {

  // TinyG applies G53 only by dropping the work offset: under G91 the values are still distances
  // (@cite EN canonical_machine.c:535-541; TG canonical_machine.c:448-451), not machine coordinates.
  if (g53 && action === undefined && distance === 'G91') {
    findings.push(block('modal-conflict', 'G53 under G91: TinyG moves by these values as distances, not to machine coordinates; use G90'));
  }
  if (g53 && action === undefined && distance === null) {
    findings.push(block('unknown-state', 'the distance mode in force is not known, so this G53 move cannot be modelled; set G90 first'));
  }
  if (axisWords.length > 0 && action === undefined && !toolSet && motionMode === 'G80') {
    findings.push(block('modal-conflict', 'axis words with G80 in effect are an error (NIST 3.5.15)'));
  }
  if (axisWords.length > 0 && action === undefined && !toolSet && motionMode === null) {
    findings.push(block('unknown-state', 'the motion mode in force is not known, so this line cannot be modelled; set G0 or G1 first'));
  }
}

export function checkArcParameters(ctx: ModelContext, { arcWords, isArcMove, findings, params, action }: CheckArcParametersInput): void {

  if (arcWords.length > 0 && !isArcMove) findings.push(block('modal-conflict', 'I, J, K or R on a line that is not an arc'));
  if (params.has('R') && ['I', 'J', 'K'].some((l) => params.has(l))) {
    findings.push(block('modal-conflict', 'an arc with both R and I/J/K is ambiguous'));
  }
  const { P } = checkOffsetParameters(ctx, { params, action, findings });
  if (action === 'G4' && P !== undefined && P.value < 0) findings.push(block('bad-parameter', 'a dwell cannot be negative'));
  if (isArcMove && P !== undefined && (!Number.isInteger(P.value) || P.value < 0)) {
    findings.push(block('bad-parameter', 'arc turns (P) must be a whole number of 0 or more'));
  }
}

export function checkOffsetParameters(ctx: ModelContext, { params, action, findings }: CheckOffsetParametersInput): { P: Word | undefined } {

  const L = params.get('L');
  if (action === 'G10' && (L === undefined || !ctx._lWords.includes(L.value))) {
    findings.push(block('l-word', `G10 needs L${ctx._lWords.join(' or L')} on this firmware`));
  }
  const P = params.get('P');
  if (action === 'G10' && (P === undefined || !Number.isInteger(P.value) || P.value < 1 || P.value > 6)) {
    findings.push(block('bad-parameter', 'G10 needs P1 to P6 to name the coordinate system'));
  }
  return { P };
}

interface CheckAxisActionsInput {
  codes: { word: Word; code: string; }[];
  units: "G20" | "G21" | null;
  distance: "G90" | "G91" | null;
  plane: "G17" | "G18" | "G19" | null;
  isArcMove: boolean;
  findings: Finding[];
  params: Map<string, Word>;
  axisWords: Word[];
  action: string | undefined;
  explicitMotion: "G0" | "G1" | "G2" | "G3" | undefined;
  g53: boolean;
  motionMode: "G0" | "G1" | "G2" | "G3" | "G80" | null
}

interface CheckAxisModeConflictsInput {
  g53: boolean;
  action: string | undefined;
  distance: "G90" | "G91" | null;
  findings: Finding[];
  axisWords: Word[];
  toolSet: boolean;
  motionMode: "G0" | "G1" | "G2" | "G3" | "G80" | null
}

interface CheckArcParametersInput {
  arcWords: string[];
  isArcMove: boolean;
  findings: Finding[];
  params: Map<string, Word>;
  action: string | undefined
}

interface CheckOffsetParametersInput {
  params: Map<string, Word>;
  action: string | undefined;
  findings: Finding[]
}
