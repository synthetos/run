import { MachineSession } from '@synthetos/machine';
import type { Decision } from '@synthetos/safety';
import { RPC_VERSION, parseRequest, type WindowIntent, type MotionCommand, type JobCommand } from './rpc.ts';
import { denied } from './hostCore.ts';
import type { HostRole } from './hostRole.ts';
/** Motion commands that are stop-class or recovery and never locked by the post-flash lock. */
const NEVER_LOCKED: ReadonlySet<MotionCommand['op']> = new Set(['jogRelease', 'spindleOff', 'coolantOff', 'clearAlarm', 'positionVerify']);


export const workspaceRole: HostRole = {
  invalidReason: 'not a machine worker request',
  createSession: options => new MachineSession(options),
  parse: parseRequest,
  settingReason: () => null,
  openReason: () => null,
  flashReason: () => null,
  intent: (session, request) => intent(session as MachineSession, request),
  extra: (request, session, checkLock) => {
    const s = session as MachineSession;
    switch(request.kind) {
      case 'motion': {
        if (!NEVER_LOCKED.has(request.command.op)) {
          const locked = checkLock('motion');
          if (locked !== null) return locked;
        }
        const decision = motion(s, request.command);
        return decision.allowed ? Object.freeze({ v: RPC_VERSION, ok: true, kind: 'motion' }) : denied('motion', decision);
      }
      case 'job': {
        if (request.command.op !== 'breakpoints' && request.command.op !== 'lineModeMemory' && request.command.op !== 'unload') {
          const locked = checkLock('job');
          if (locked !== null) return locked;
        }
        const decision = job(s, request.command);
        return decision.allowed ? Object.freeze({ v: RPC_VERSION, ok: true, kind: 'job' }) : denied('job', decision);
      }
      default: return null;
    }
  },
};
function intent(session: MachineSession, intent: WindowIntent): Decision {
    switch (intent) {
      case 'feedhold':
        return session.feedhold();
      case 'stopJob':
        return session.stopJob();
      case 'spindleOffNow':
        return session.spindleOffNow();
      case 'ackFault':
        return session.ackFault();
      case 'acknowledgeLost':
        return session.acknowledgeLost();
    }
  }

  /** A Phase 2 motion command, as the session intent it is (SAFETY §4.5b). The session decides it. */
function motion(session: MachineSession, c: MotionCommand): Decision {
    const s = session;
    switch (c.op) {
      case 'jog':
        return s.request({ intent: 'jog', axes: c.axes, distanceMm: c.distanceMm, feed: c.feed });
      case 'jogRenew':
        return s.request({ intent: 'jog', renew: true });
      case 'jogRelease':
        return s.request({ intent: 'feedhold', release: true });
      case 'goToZero':
        return s.request({ intent: 'goToZero', axes: c.axes, safeZ: c.safeZ });
      case 'setZero':
        return s.request({ intent: 'setWorkZero', axes: c.axes });
      case 'home':
        return s.request({ intent: 'home', axes: c.axes });
      case 'setPosition':
        return s.request({ intent: 'setMachinePosition', axes: c.axes });
      case 'tempOffset':
        return s.request({ intent: 'tempOffset', axes: c.axes });
      case 'clearTempOffset':
        return s.request({ intent: 'tempOffset', clear: true });
      case 'selectCoord':
        return s.request({ intent: 'selectCoordSystem', system: c.system });
      case 'spindleOn':
        return s.request({ intent: 'spindleOn', output: 'spindle', direction: c.direction, rpm: c.rpm });
      case 'coolantOn':
        return s.request({ intent: 'spindleOn', output: c.which });
      case 'typedMove':
        return s.request({ intent: 'typedMove', line: c.line, travel: c.travel, lowZ: c.lowZ });
      // Probe Z (SAFETY §4.5c): each decided again by the session.
      case 'probeTouch':
        return s.request({ intent: 'probeZ', step: 'touch', thicknessMm: c.thicknessMm, depthMm: c.depthMm, feed: c.feed });
      case 'probeStart':
        return s.request({ intent: 'probeZ', step: 'start', confirm: c.confirm });
      case 'probeRetest':
        return s.request({ intent: 'probeZ', step: 'retest' });
      case 'probeCancel':
        return s.request({ intent: 'probeZClose', step: 'cancel' });
      case 'probePlateOff':
        return s.request({ intent: 'probeZClose', step: 'plateOff' });
      case 'spindleOff':
        return s.request({ intent: 'spindleOffNow', outputs: 'spindle' });
      case 'coolantOff':
        return s.request({ intent: 'spindleOffNow', outputs: 'coolant' });
      case 'resume':
        return s.request({ intent: 'resume' });
      case 'clearAlarm':
        return s.request({ intent: 'clearAlarm' });
      case 'positionVerify':
        return s.request({ intent: 'positionVerify' });
    }
  }

  /** A Phase 3 job command, as the session call it is (SAFETY §4.4a). The session decides it. */
function job(session: MachineSession, c: JobCommand): Decision {
    const s = session;
    switch (c.op) {
      case 'override': return s.setOverride({ channel: c.channel, percent: c.percent });
      case 'load':
        return s.loadJob({ name: c.name, text: c.text, c22: c.c22 });
      case 'unload':
        return s.loadJob(null);
      case 'start':
        return s.startJob(c.breakpoints, c.confirm);
      case 'resume':
        return s.request({ intent: 'resume', skip: c.skip, spindleRestart: c.spindleRestart });
      case 'breakpoints':
        return s.setBreakpoints(c.lines);
      case 'lineModeMemory':
        s.rememberLineMode(c.epoch, c.remembered);
        return { allowed: true };
    }
  }

