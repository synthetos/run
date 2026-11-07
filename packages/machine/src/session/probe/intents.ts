/**
 * Probe Z: the owner's five commands, each decided again by the session (SAFETY §4.5c; T-S128-T-S131), and what
 * the probe refuses of other intents while it owns the machine or while the plate is out.
 */
import type { Decision } from '@synthetos/safety';
import { requestPoll } from '../motion.ts';
import type { SessionIntent, SessionState } from '../types.ts';
import { finish, setProbe, tick, queueRead, type ProbeTx } from './common.ts';
import { probeBlock } from './gate.ts';
import { makePlan } from './plan.ts';
import { SETTING_TOKENS, TOUCH_NONE, probeOpen, probeRunning } from './state.ts';
import { anchorOf } from './sync.ts';
import { touchPassed } from './touch.ts';
import type { ProbeBlock } from './types.ts';

const CITATION = 'SAFETY §4.5c';
const ALLOWED: Decision = Object.freeze({ allowed: true });

function deny(reason: string, remedy: string): Decision {
  return { allowed: false, reason, remedy, citation: CITATION };
}

/** A reading older than this is not "live" for the start. */
const READING_FRESH_MS = 1000;

/** §4.5c "After": Start job and Spindle on are refused while the plate is out. */
export const PLATE_OUT_TEXT = 'Take the touch plate and lead off first, then confirm it under Position.';

/** Each block's reason and next step (the page has its own fuller copy, docs/design/probe-z-ui.md §1). */
const BLOCK_TEXT: Readonly<Record<ProbeBlock, readonly [string, string]>> = {
  notConnected: ['No machine is connected.', 'Connect, then open Probe Z again.'],
  lost: ['The connection is lost.', 'Reconnect, then check the machine.'],
  stale: ['No status from the machine.', 'Wait for it to answer.'],
  otherTab: ['This machine is controlled in another tab.', 'Use that tab.'],
  firmware: ["This firmware can't probe. Probe Z needs an approved edge-next build (450.02 or later).", 'Zero Z by hand: touch off, then use Set Z work zero.'],
  motionOff: ['Motion control is not enabled in this build.', 'Zero Z by hand.'],
  settingsUnread: ["Run hasn't read the board's probe settings yet.", 'Wait for the read to finish.'],
  noInput: ['This board has no probe input set.', 'Zero Z by hand: touch off, then use Set Z work zero.'],
  manyInputs: ["This board has more than one probe input set, so Run won't guess.", 'Zero Z by hand.'],
  inputNotZ: ['The probe input is not a Z input.', 'Zero Z by hand.'],
  jerkUnread: ["Run can't work out how far Z will travel after contact.", 'Reconnect so Run reads the board again, or zero Z by hand.'],
  stopOverLimit: ['Z would travel too far after contact on this machine, even at the slowest feed.', 'Zero Z by hand.'],
  alarm: ['The controller is in alarm.', 'Clear the alarm, then open Probe Z again.'],
  spindleOn: ['The spindle is on.', 'Turn it off, then open Probe Z again.'],
  moving: ['A move is running.', 'Wait for it to finish.'],
  homing: ['Homing is running.', 'Wait for it to finish.'],
  held: ['The machine is paused.', 'Resume or use Stop job first.'],
  job: ['Not available while a job is in progress.', 'Finish or stop the job.'],
  toolChange: ['Not available during a tool change.', 'Set Z with the tool-change Z zero.'],
  unknown: ['The position is not verified.', 'Check the machine, then confirm it.'],
  needsReview: ["The board's settings differ from the reference.", 'Review them first.'],
  tempOffset: ['A temporary offset (G92) is in force.', 'Clear it on the Offsets tab.'],
  noWcs: ["No work coordinate system is active, so there's no Z zero to set.", 'Choose G54 to G59.'],
};

function blocked(block: ProbeBlock): Decision {
  const [reason, remedy] = BLOCK_TEXT[block];
  return deny(reason, remedy);
}

/** The five commands (`probeZ`: touch, start, retest; `probeZClose`: cancel, plate off). The matrix has allowed the intent. */
export function onProbeIntent(t: ProbeTx, request: Extract<SessionIntent, { intent: 'probeZ' | 'probeZClose' }>, at: number): Decision {
  const p = t.s.probeZ;
  switch (request.step) {
    case 'touch': {
      if (probeRunning(p.step)) return deny('The probe is running.', 'Use Stop job to end it.');
      const block = probeBlock(t.s, t.config);
      if (block !== null) return blocked(block);
      const plan = makePlan(request.thicknessMm, request.depthMm, request.feed, p.settings.zjh);
      if (typeof plan === 'string') return deny(plan, 'Change it and try again.');
      // The plate is out from here until the owner says it is off. The probe settings are read again first.
      setProbe(t, { step: 'touch', plan, touch: TOUCH_NONE, touchAt: null, passedAt: null, anchor: null, outcome: null, run: null, plateOut: true, refreshing: true, reading: null, readingAt: null, alarmExpected: false });
      for (const token of SETTING_TOKENS) queueRead(t, token);
      return ALLOWED;
    }
    case 'retest': {
      if (p.step !== 'touch' && p.step !== 'ready') return deny('There is no touch test to repeat.', 'Open Probe Z first.');
      const block = probeBlock(t.s, t.config);
      if (block !== null) return blocked(block);
      setProbe(t, { step: 'touch', touch: TOUCH_NONE, touchAt: null, passedAt: null, anchor: p.refreshing ? null : anchorOf(t.s) });
      if (!p.refreshing) tick(t);
      return ALLOWED;
    }
    case 'start':
      return start(t, request.confirm, at);
    case 'cancel': {
      if (probeRunning(p.step)) return deny('The probe is running.', 'To stop it, use Stop job.');
      if (p.step !== 'touch' && p.step !== 'ready') return deny('There is nothing to cancel.', 'Nothing to do.');
      finish(t, { kind: 'cancelled' }, at);
      return ALLOWED;
    }
    case 'plateOff': {
      // Writes nothing. Refused only while the probe still owns the machine.
      if (probeRunning(p.step)) return deny('The probe is running.', 'Use Stop job to end it.');
      if (p.step === 'touch' || p.step === 'ready') return deny('The touch test is still open.', 'Cancel it first.');
      setProbe(t, { step: 'closed', plateOut: false, alarmExpected: false });
      return ALLOWED;
    }
    default:
      return deny('Unknown Probe Z command.', 'Reload the page.');
  }
}

/** Start the probe after C39 (§4.5c "The probe"): one `G38.2` per owner action, from the plan the touch test holds. */
function start(t: ProbeTx, confirm: unknown, at: number): Decision {
  const s = t.s;
  const p = s.probeZ;
  if (confirm !== true) return deny('Starting the probe needs its confirmation (C39).', 'Read it, tick the plate box, then start.');
  if (p.step !== 'ready' || p.plan === null || !touchPassed(p.touch)) return deny('The touch test has not passed.', 'Run the touch test first.');
  const block = probeBlock(s, t.config);
  if (block !== null) return blocked(block);
  if (p.reading !== 'clear' || p.readingAt === null || at - p.readingAt > READING_FRESH_MS) return deny('The probe input does not read Not touching right now.', 'Raise the tool off the plate, then start.');
  // The board's settings may have been read again since the plan: the stop distance must be the one C39 showed.
  const plan = makePlan(p.plan.thicknessMm, p.plan.depthMm, p.plan.feed, p.settings.zjh);
  if (typeof plan === 'string' || plan.stopMm !== p.plan.stopMm) return deny("The board's probe settings changed.", 'Run the touch test again.');
  setProbe(t, {
    step: 'starting',
    run: { fromPos: s.live.pos.z ?? null, fromMpo: s.live.mpo.z ?? null, units: s.live.unit, dist: s.live.dist, checked: false, sent: false, deadline: null, stopped: null, report: null, confirmed: 0, zero: null, settleUntil: null, readback: {}, pending: null },
  });
  // A move in progress: Disconnect is refused and Pause and Stop job are prominent. First, one polled cycle at rest.
  t.set({ base: 'JOGGING' });
  requestPoll(t);
  tick(t);
  return ALLOWED;
}

const HELD_WHILE_OPEN: ReadonlySet<string> = new Set(['jog', 'goToZero', 'setWorkZero', 'home', 'setMachinePosition', 'tempOffset', 'selectCoordSystem', 'spindleOn', 'settingsWrite', 'flash', 'startJob', 'resume']);

/** What the probe refuses of other intents: anything that moves or changes the machine while it is open, and Start job and Spindle on while the plate is out. */
export function probeRefusal(s: SessionState, request: SessionIntent): Decision | undefined {
  const p = s.probeZ;
  if (probeOpen(p.step) && HELD_WHILE_OPEN.has(request.intent)) {
    return request.intent === 'jog' ? deny('Jog is off during the touch test and the probe: a hand may be at the tool.', 'Finish or cancel Probe Z first.') : deny('Probe Z is in progress.', 'Finish or cancel Probe Z first.');
  }
  const spindle = request.intent === 'spindleOn' && request.output === 'spindle';
  if (p.plateOut && (request.intent === 'startJob' || spindle)) return deny(PLATE_OUT_TEXT, 'Then press "The plate is off" under Position.');
  return undefined;
}

