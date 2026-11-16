import { type Decision } from '@synthetos/safety';
import type { SessionIntent } from '../types.ts';
import { type MotionTx } from './contract.ts';
import { onHome, onPositionVerify, onSetMachinePosition } from './homing.ts';
import { onJog } from './jog.ts';
import { onClearAlarm, onSpindleOn } from './outputs.ts';
import { onResume } from './stops.ts';
import { onGoToZero, onSelectCoordSystem, onSetWorkZero, onTempOffset } from './zero.ts';

/**
 * A Phase 2 motion intent the matrix has already allowed. Returns the decision; on success the lines
 * are queued. `jog` with `renew` only refreshes a hold jog's keep-alive.
 */
export function onMotionIntent(t: MotionTx, request: SessionIntent, at: number): Decision {
  const s = t.s;
  switch (request.intent) {
    case 'jog': {
      return onJog(t, request, at, s);
    }
    case 'goToZero': {
      return onGoToZero(t, request, s);
    }
    case 'setWorkZero': {
      return onSetWorkZero(t, request, s);
    }
    case 'home': {
      return onHome(t, request, s);
    }
    case 'setMachinePosition': {
      return onSetMachinePosition(t, request, s);
    }
    case 'tempOffset': {
      return onTempOffset(t, request, s);
    }
    case 'selectCoordSystem': {
      return onSelectCoordSystem(t, request, s);
    }
    case 'spindleOn': {
      return onSpindleOn(t, request);
    }
    case 'clearAlarm': {
      return onClearAlarm(t);
    }
    case 'resume': {
      return onResume(t, at, s);
    }
    default: {
      return onPositionVerify(t, s);
    }
  }
}
