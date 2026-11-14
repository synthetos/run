/** Fixed firmware role: the worker entry imports this instead of workspaceRole. */
import { FirmwareSession } from '@synthetos/machine';
import type { HostRole } from './hostRole.ts';
import { parseBaseRequest } from './rpc.ts';
const REASON = 'This page only updates firmware. Use the signed-in workspace for machine control.';
export const firmwareRole: HostRole = {
  invalidReason: REASON,
  createSession: options => new FirmwareSession(options),
  parse: data => {
    const request = parseBaseRequest(data);
    if (request?.kind === 'drift' || request?.kind === 'transcript') return null;
    return request;
  },
  extra: () => null,
  intent: (session, request) => request === 'ackFault' ? session.ackFault() : request === 'acknowledgeLost' ? session.acknowledgeLost() : { allowed: false, reason: REASON, remedy: 'Disconnect, or continue the firmware update.', citation: 'SAFETY §4.8' },
  settingReason: (flash, session) => {
    const post = flash.postFlash;
    return post?.phase === 'restoreRequired' && post.boardId === session.snapshot.identity?.id ? null : 'Only the settings restore required by this firmware update may write settings.';
  },
  openReason: request => (request.trusted?.length ?? 0) > 0 ? 'This page accepts only the signed firmware list.' : null,
  flashReason: command => command.op === 'begin' && command.source.kind !== 'release' ? 'This page installs only releases from the signed firmware list.' : null,
};
