/** A role is compiled into its worker entry. It is never received from a page. */
import type { SessionExecutor, MachineSessionOptions, TransportSource, SessionClock, PlatformInfo } from '@synthetos/machine';
import type { Decision, Release } from '@synthetos/safety';
import type { MachineRequest, MachineReply, WindowIntent, FlashCommand } from './rpc.ts';
import type { FlashService } from './flashService.ts';
import type { WorkerApproval } from './hostCore.ts';
import type { BootloaderMarks } from './bootloaderMark.ts';
export type HostOptions = [source: TransportSource, clock?: SessionClock, platform?: PlatformInfo, approval?: WorkerApproval | null, release?: Release, marks?: BootloaderMarks];
export interface HostRole {
  readonly invalidReason: string;
  createSession(options: MachineSessionOptions): SessionExecutor;
  parse(data: unknown): MachineRequest | null;
  intent(session: SessionExecutor, request: WindowIntent): Decision;
  extra(request: MachineRequest, session: SessionExecutor, locked: (kind: 'motion' | 'job') => MachineReply | null): MachineReply | null;
  settingReason(flash: FlashService, session: SessionExecutor): string | null;
  openReason(request: Extract<MachineRequest, { kind: 'open' }>): string | null;
  flashReason(command: FlashCommand): string | null;
}
