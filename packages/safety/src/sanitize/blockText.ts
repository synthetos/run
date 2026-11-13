/** Display text only: H35 and the dialect's mid-file rule still decide whether a file is blocked. */
export function programEndBlockText(line: number): string {
  return `Program end (M2/M30) at line ${line}, but the file continues after it. A queued program end can clear an alarm on this firmware and let later lines run, so Run will not send this file. Fix: remove the extra M2/M30 (often from joining files), or split the file.`;
}

/** Keep the specific offending value from the checker, followed by an actionable repair. */
export const BLOCK_FIXES: Readonly<Record<string, string>> = {
  'read-only-dialect': 'Use firmware that Run supports for sending jobs.',
  'control-byte': 'Remove the control byte and export the file as plain-text G-code.',
  'unclosed-comment': 'Close the comment with a right parenthesis, or remove it.',
  'text-after-comment': 'Move the commands after the comment onto a separate line.',
  'first-character': 'Remove the controller command, or export the file with a post-processor for this controller.',
  'realtime-character': 'Remove the realtime command from the file; use Run’s controls instead.',
  'non-ascii': 'Replace the non-ASCII character with plain ASCII text.',
  'invalid-character': 'Correct or remove the invalid character in your source file.',
  malformed: 'Correct the syntax or arc geometry, then export the file again.',
  'parse-error': 'Correct the G-code syntax, then open the corrected file.',
  m100: 'Remove M100; change board settings through Board instead.',
  probe: 'Remove the probing operation from this file and use the supported probing controls.',
  'unsupported-code': 'Export using a postprocessor for this firmware, or replace the unsupported command.',
  'unsupported-word': 'Remove the unsupported word or put the unsupported combined move on its own line.',
  'modal-conflict': 'Separate conflicting commands and explicitly set the intended motion and distance modes.',
  'negative-feed': 'Set F to a positive feed rate in the file or CAM setup.',
  'negative-speed': 'Set S to a non-negative spindle speed in the file or CAM setup.',
  'bad-tool': 'Use a whole tool number in the supported range.',
  'bad-parameter': 'Correct the named parameter to a value the command accepts.',
  'l-word': 'Use a supported L value with G10 for this firmware.',
  'm6-without-c14': 'Use supported firmware and Run’s manual tool-change workflow, or split the file by tool.',
  'feed-not-set': 'Put a positive F feed rate before the first cutting move.',
  'unknown-state': 'Set the missing units or modes explicitly; read the board’s settings and position before checking again.',
  'no-velocity-limit': 'Read the board’s axis speed limits and set valid positive limits before checking again.',
  'rotary-radius': 'Read and correct the rotary axis mode and radius, then check the file again.',
  'axis-mode': 'Read and correct the named axis mode before checking the file again.',
  'inhibited-axis': 'Resolve the inhibited axis position and configuration before checking again.',
  'arc-ambiguous': 'Export this arc as short straight moves, or adjust its endpoints in CAM.',
  'arc-rejected': 'Correct the arc geometry in CAM, or export it as short straight moves.',
  'split-impossible': 'Export shorter moves in CAM or correct the stated move parameters.',
  'too-long': 'Shorten the line or export shorter moves so each numbered line fits the controller.',
  'end-state': 'End the file with M5 and M9 before its final M2/M30; remove any output-on commands from that last line.',
  'g18-arc': 'Export the XZ arc as short straight moves for this firmware.',
  'g28-g30-g20-g91': 'Replace this return move with explicit moves in a supported units and distance mode.',
  'g28.4': 'Remove G28.4; establish the machine position through the supported homing controls.',
  'e-word': 'Remove E words or export with a postprocessor for this controller.',
  'e088-queued-per-line': 'Put queued commands on separate lines, with at most three queued commands plus motion per line.',
  g93: 'Export with G94 feed per minute instead of G93 inverse-time feed.',
  'm201.3': 'Remove M201.3 and configure acceleration smoothness (jerk) through Board before the job.',
  'barrier-mismatch': 'Recheck the file with the current optional-stop and firmware settings.',
  'out-of-bounds': 'Correct the job placement, stock zero or toolpath so the move stays inside travel.',
  'arc-out-of-bounds': 'Correct the arc or job placement so its entire path stays inside travel.',
  'dialect-mismatch': 'Reopen and check the file for the selected firmware.',
};

const EXPLANATIONS: Readonly<Record<string, string>> = {
  'unclosed-comment': 'An opening parenthesis has no closing parenthesis, so the controller would ignore the rest of this line',
  'text-after-comment': 'Commands follow a comment on this line, but this firmware ignores them',
  'negative-feed': 'The feed rate is negative, which the controller rejects',
  'negative-speed': 'The spindle speed is negative, which the controller rejects',
  'arc-ambiguous': 'Number rounding could make this arc take an unintended path on this firmware',
  'm201.3': 'M201.3 changes acceleration smoothness as the file is read, before earlier queued moves finish',
  'g93': 'Run cannot verify the requested speed with G93 inverse-time feed on this firmware',
  'e088-queued-per-line': 'This line queues too many controller actions at once and can shut the controller down',
  'g28.4': 'G28.4 changes the recorded machine position without homing, so later moves could go to the wrong place',
  'e-word': 'E is read as part of a number rather than as an axis or command on this firmware',
  'm100': 'M100 runs controller commands inside the file, which Run cannot safely allow in a job',
  'probe': 'This file includes probing, which Run cannot safely stream as an ordinary job',
};

// Specific checker remedies take precedence over a generic rule-level repair. Match
// an instruction at a sentence/clause boundary, not a verb inside an explanation.
const HAS_REPAIR = /(?:^|[.;:]\s+)(?:Fix:|(?:remove|export|set|use|write|move|check|read|correct|replace|add|close|separate|resolve|reopen|recheck|shorten|split|reduce|increase|choose|put)\b)/i;

export function blockFindingText(rule: string, detail: string, line: number): string {
  if (rule === 'mid-file-program-end') return programEndBlockText(line);
  // Engineering references remain in the source and Advanced rule details, not the repair sentence.
  const hasRepair = HAS_REPAIR.test(detail);
  const plain = (hasRepair ? detail : EXPLANATIONS[rule] ?? detail).replace(/\s*\((?:H\d|E\d|NIST|PN §)[^)]*\)/g, '').replace(/; accept C22 to add M5 and M9/g, '').replace(/[.;\s]+$/, '');
  const sentence = plain.charAt(0).toUpperCase() + plain.slice(1);
  if (hasRepair) return `${sentence}.`;
  return `${sentence}. Fix: ${BLOCK_FIXES[rule] ?? 'Correct this line in the source file and check it again before running.'}`;
}

/** A sentence continuation for callers supplying their own context and next action.
 * Keep code/axis capitals (G53, Z), but omit the list-only generic repair and terminator. */
export function findingReason(message: string): string {
  return message.trim().replace(/\s+Fix:[\s\S]*$/, '').replace(/[.;\s]+$/, '').replace(/^[A-Z](?=[a-z])/, first => first.toLowerCase());
}
