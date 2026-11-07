/**
 * Probe Z's plain words (SAFETY §4.5c, H90): why it can't run and what to do next, and what each outcome means.
 * "Contact" is the board's word; nothing here says the tool touched the plate or that zero is set unless the
 * session reported it. The safety strings (W51, W52, C39) come from @synthetos/safety via probeStrings.ts. Pure.
 */
import type { ProbeBlock, ProbeOutcome } from '../../machine-worker/probeShared.ts';
import { mm } from './probeStrings.ts';

export interface BlockCopy {
  readonly reason: string;
  /** What to do next, or null when there is nothing the owner can do here. */
  readonly next: string | null;
}

const BY_HAND = 'Zero Z by hand: touch off, then use Set Z work zero here.';

export const BLOCK_COPY: Readonly<Record<ProbeBlock, BlockCopy>> = Object.freeze({
  notConnected: { reason: 'No machine is connected.', next: 'Connect, then open Probe Z again.' },
  lost: { reason: 'The connection is lost.', next: 'Reconnect, then check the machine.' },
  stale: { reason: 'No status from the machine.', next: 'Wait for it to answer.' },
  otherTab: { reason: 'This machine is controlled in another tab.', next: 'Use that tab.' },
  firmware: { reason: 'This firmware can’t probe. Probe Z needs an approved edge-next build, 450.02 or later.', next: BY_HAND },
  motionOff: { reason: 'Probing is not available in this build.', next: null },
  settingsUnread: { reason: 'Run hasn’t read the board’s probe settings yet.', next: 'Wait for the read to finish.' },
  noInput: { reason: 'This board has no probe input set.', next: BY_HAND },
  manyInputs: { reason: 'This board has more than one probe input set, so Run won’t guess.', next: BY_HAND },
  inputNotZ: { reason: 'The probe input isn’t a Z input. Probe Z needs it on Z min or Z max.', next: BY_HAND },
  jerkUnread: { reason: 'Run can’t work out how far Z will travel after contact.', next: 'Reconnect so Run reads the board again, or zero Z by hand.' },
  stopOverLimit: { reason: 'Z would travel too far after contact on this machine, even at the slowest feed.', next: BY_HAND },
  alarm: { reason: 'The controller is in alarm.', next: 'Clear the alarm, then open Probe Z again.' },
  spindleOn: { reason: 'The spindle is on.', next: 'Turn it off, then open Probe Z again.' },
  moving: { reason: 'A move is running.', next: 'Wait for it to finish.' },
  homing: { reason: 'Homing is running.', next: 'Wait for it to finish.' },
  held: { reason: 'The machine is paused.', next: 'Resume, or use Stop job first.' },
  job: { reason: 'Not available while a job is in progress.', next: 'Finish or stop the job.' },
  toolChange: { reason: 'Not available during a tool change.', next: 'Set Z with the tool change’s Z zero.' },
  unknown: { reason: 'The previous session ended while connected.', next: 'Check the machine, then confirm above.' },
  needsReview: { reason: 'The board’s settings differ from the reference.', next: 'Review them first.' },
  tempOffset: { reason: 'A temporary offset is in force.', next: 'Clear it on the Offsets tab (Advanced).' },
  noWcs: { reason: 'No work coordinate system is active, so there’s no Z zero to set.', next: 'Choose G54 to G59 on the Offsets tab (Advanced).' },
});

/** What the Result card offers besides "The plate is off". */
export type ResultAction = 'lift' | 'clear' | 'none';

export interface OutcomeCopy {
  readonly headline: string;
  readonly body: string;
  /** True for a contact with the zero set; everything else is an alert. */
  readonly ok: boolean;
  /** `lift`: Lift Z (once no alarm is showing). `clear`: Clear alarm, then Lift Z. `none`: the jog pad, or nothing. */
  readonly action: ResultAction;
}

const UNCHANGED = 'Z zero is unchanged.';

/** The words for one outcome. `system` is the work system the zero went to (G54). */
export function outcomeCopy(outcome: ProbeOutcome, system: string): OutcomeCopy {
  switch (outcome.kind) {
    case 'contactZeroSet':
      return {
        headline: 'Contact. Z zero is set.',
        body: `The board reports ${system} Z at ${mm(outcome.zeroZ)} mm after ${mm(outcome.travelMm)} mm of travel. The tool is resting on the plate. Lift Z, then take the plate and lead off. If a job is loaded, it is checked again before it starts.`,
        ok: true,
        action: 'lift',
      };
    case 'noContact':
      return {
        headline: `No contact. ${UNCHANGED}`,
        body: `${outcome.travelMm === null ? 'Z went down' : `Z went down ${mm(outcome.travelMm)} mm`} and the board reported no contact. Check the lead and clip, and look at the tool: if the lead came off it may have pressed into the plate or the work. Clear the alarm, then raise Z.`,
        ok: false,
        action: 'clear',
      };
    case 'alreadyTripped':
      return { headline: 'Input already touching. Z didn’t move.', body: `${UNCHANGED} Check that the tool isn’t on the plate, then check the lead and clip for a break or short. Clear the alarm, then raise Z if you need to.`, ok: false, action: 'clear' };
    case 'softLimit':
      return { headline: 'That move would pass the soft limit. Z didn’t move.', body: `${UNCHANGED} Clear the alarm, raise Z, and try a smaller depth limit.`, ok: false, action: 'clear' };
    case 'limit':
      return { headline: 'A limit switch tripped. Z stopped fast.', body: `${UNCHANGED} A fast stop can lose position: home before you trust it. Clear the alarm, then jog away from the switch.`, ok: false, action: 'none' };
    case 'refused':
      return {
        headline: 'The board refused the probe. Z didn’t move.',
        body: outcome.status === 251 ? `The depth limit is too short for the board. ${UNCHANGED} Try a larger depth limit.` : `It said: “${outcome.text}”. ${UNCHANGED}`,
        ok: false,
        action: 'none',
      };
    case 'stopJob':
      return { headline: `Stopped. ${UNCHANGED}`, body: 'Stop job ended the probe. Spindle and coolant were commanded off. Clear the alarm, then raise Z.', ok: false, action: 'clear' };
    case 'paused':
      return { headline: `Pause ended the probe. ${UNCHANGED}`, body: 'A probe can’t be paused or resumed. Clear the alarm if the board shows one, then raise Z.', ok: false, action: 'clear' };
    case 'lost':
      return outcome.during === 'probe'
        ? { headline: 'The connection dropped during the probe.', body: 'Run can’t tell whether Z is still moving or where it stopped. Use your E-stop if anything is unsafe. Z zero wasn’t set. Reconnect and check the machine; Run treats the position as unverified.', ok: false, action: 'none' }
        : { headline: 'The connection dropped while setting Z.', body: 'Run can’t tell whether Z zero changed. Check it after you reconnect, before you cut anything.', ok: false, action: 'none' };
    case 'noReport':
      return { headline: 'No answer from the board.', body: 'Z should have stopped by now, and Run has no result. Use your E-stop if it’s still moving. Z zero wasn’t set.', ok: false, action: 'none' };
    case 'zeroRefused':
      return { headline: 'Contact, but Z zero wasn’t set.', body: `The board refused the zero: “${outcome.text}”. ${UNCHANGED} Lift Z and probe again, or zero Z by hand.`, ok: false, action: 'lift' };
    case 'zeroUnconfirmed':
      return { headline: 'Contact, but Run can’t confirm Z zero.', body: 'The board didn’t confirm the new zero. Check the Z reading above before you cut anything.', ok: false, action: 'lift' };
    case 'cancelled':
      return { headline: 'Probe cancelled. Nothing moved.', body: 'Take the plate and lead off the machine.', ok: true, action: 'none' };
  }
}

/** The board's status for Advanced, or null when the outcome has none. */
export function outcomeStatus(outcome: ProbeOutcome): number | null {
  return 'status' in outcome ? outcome.status : null;
}

/** The meaning C13 names when the owner clears the alarm a probe ended in. */
export function alarmMeaning(outcome: ProbeOutcome | null, stat: number | undefined): string {
  switch (outcome?.kind) {
    case 'noContact':
      return 'The probe ended without contact (alarm 250) and Z stopped at the depth limit';
    case 'alreadyTripped':
      return 'The probe input was already touching (alarm 250) and Z didn’t move';
    case 'softLimit':
      return 'The probe move would have passed a soft limit (alarm 220) and Z didn’t move';
    case 'limit':
      return 'A limit switch tripped during the probe (alarm 203) and Z stopped fast';
    case 'stopJob':
      return 'Stop job ended the probe (alarm 207)';
    case 'paused':
      return 'Pause ended the probe in an alarm';
    default:
      return `The controller reports an alarm (state ${stat ?? 'unknown'}) and stopped any motion`;
  }
}
