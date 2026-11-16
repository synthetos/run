/**
 * Per-line analysis for the sanitiser (SAFETY §4.7 steps 6, 6a and the
 * state that steps 7–8a need).
 *
 * A small modal model of the job, just enough to apply the dialect's block
 * rules and to model every move against the queued-motion ceiling: units,
 * distance and arc-distance mode, plane, motion mode, feed, the work
 * coordinate system and offsets, and the position in work and machine
 * coordinates. What the model does not know stays unknown (`null`); a move
 * whose length depends on an unknown is blocked, never guessed.
 *
 * Semantics follow EN, the primary target (@cite EN gcode_parser.c
 * `_parse_gcode_block`, `_validate_gcode_block`, `_execute_gcode_block`;
 * canonical_machine.c offsets and stored positions). Where TG differs, the
 * difference is dialect data (`Dialect.gcode`), never a branch on the
 * dialect id. This is not the preview interpreter (TB-02): it only decides
 * what may be sent and how long moves are split.
 */
import type { Dialect, DialectJobGcode } from '@synthetos/protocol';
import { chargeJointResidual } from './analyze/axisModes.ts';
import { commitModal } from './analyze/commit.ts';
import { ModelState, type ModelContext } from './analyze/context.ts';
import { type LineAnalysis } from './analyze/contract.ts';
import { checkArcParameters, checkAxisActions, checkAxisModeConflicts } from './analyze/dialectRules.ts';
import { dispatchMotion } from './analyze/dispatch.ts';
import { checkJointRisk, checkMoveModes, checkStoredAxes, deriveFeed } from './analyze/feed.ts';
import { flowFlags } from './analyze/flow.ts';
import { initialize } from './analyze/initialize.ts';
import { totalOffset } from './analyze/offsets.ts';
import { outputsOn, updateOutputs } from './analyze/outputs.ts';
import { candidateMotion, candidateUnits, checkToolWords } from './analyze/toolWords.ts';
import { collectWords } from './analyze/words.ts';
import { type Word } from './lex.ts';
import type { Axis, SanitizeOptions } from './types.ts';

/** Analyses one line (comments and N words already removed) and advances the model. */
function analyzeLine(ctx: ModelContext, words: readonly Word[]): LineAnalysis {
  const { params, findings, job, has, codes } = collectWords(ctx, { words });
  const { F, toolChange, S, T } = checkToolWords(ctx, { params, findings, job, has });
  const { units, distance, plane, arcDistance } = candidateUnits(ctx, { has });
  const { isArcMove, axisWords, action, explicitMotion, g53, motionMode, toolSet, arcWords, isLinearMove, toolCancel, wcs } = candidateMotion(ctx, { codes, has, words, params });
  checkAxisActions(ctx, { codes, units, distance, plane, isArcMove, findings, params, axisWords, action, explicitMotion, g53, motionMode });
  checkAxisModeConflicts({ g53, action, distance, findings, axisWords, toolSet, motionMode });
  checkArcParameters(ctx, { arcWords, isArcMove, findings, params, action });
  const { feed } = deriveFeed(ctx, { F, isArcMove, isLinearMove, motionMode, findings });
  checkMoveModes(ctx, { isLinearMove, axisWords, findings, isArcMove });
  checkStoredAxes(ctx, { action, findings });
  checkJointRisk(ctx, { isLinearMove, isArcMove, action, findings });
  const { programStop, optionalStop, programEnd, outputsOn } = flowFlags({ has, codes });
  if (findings.some((f) => f.severity === 'block')) {
    // A rejected line is never sent, so it changes nothing: the rest of the file is analysed as it would
    // run without it, and its findings are not buried under consequences of this one.
    return { findings, ok: false, motion: null, toolChange, programStop, optionalStop, programEnd, outputsOn, extent: null };
  }
  commitModal(ctx, { units, distance, arcDistance, plane, motionMode, feed, toolSet, axisWords, toolCancel, wcs });
  const { motion } = dispatchMotion(ctx, { action, axisWords, units, distance, params, findings, isLinearMove, codes, motionMode, g53, isArcMove, arcDistance, plane });
  updateOutputs(ctx, { S, T, has, programEnd });

  const ok = !findings.some((f) => f.severity === 'block');
  return { findings, ok, motion: ok ? chargeJointResidual(ctx, motion) : null, toolChange, programStop, optionalStop, programEnd, outputsOn, extent: ok && motion !== null ? ctx._extent : null };
}

export type { Finding, LineAnalysis } from './analyze/contract.ts';

/** One mutable context per sanitiser run; steps receive this same instance. */
export class JobModel extends ModelState {
  constructor(dialect: Dialect, job: DialectJobGcode, options: SanitizeOptions) { super(); initialize(this, dialect, job, options); }
  analyze(words: readonly Word[]): LineAnalysis { return analyzeLine(this, words); }
  totalOffset(axis: Axis): number | null { return totalOffset(this, axis); }
  outputsOn(): boolean { return outputsOn(this); }
}
