import { RPC_VERSION, type MachineRequest, type MachineReply } from '../machine-worker/rpc.ts';
/**
 * The `open` request for the port the window chose. `previousSessionEnded` is the W6 state (a reload
 * or discard ended a LIVE session), so the worker starts this connect in UNKNOWN (SAFETY §3).
 */
export function openRequest(
  port: Extract<MachineRequest, { kind: 'open' }>['port'],
  previousSessionEnded: boolean,
  trusted: Extract<MachineRequest, { kind: 'open' }>['trusted'] = [],
): Extract<MachineRequest, { kind: 'open' }> {
  // SAFETY H87: the custom builds the user trusted, each for one board, only while this browser's record says the
  // board still runs that image (firmware/store.ts activeTrust). The worker restricts each to its board id.
  return { v: RPC_VERSION, kind: 'open', port, boardId: null, previousSessionEnded, ...(trusted === undefined || trusted.length === 0 ? {} : { trusted }) };
}

/**
 * Prepare without opening; confirm original window objects; open only the held worker port. `confirm`
 * also refuses if any port connected or disconnected since the choice (the chooser's event guard,
 * docs/safety/PORT_SELECTION.md); LIVE entry releases that guard on every exit (liveEntry.ts).
 */
export async function openConfirmedPort(
  call: (request: MachineRequest) => Promise<MachineReply>,
  port: Extract<MachineRequest, { kind: 'open' }>['port'],
  confirm: (() => Promise<boolean>) | undefined,
  previousSessionEnded: boolean,
  trusted: Extract<MachineRequest, { kind: 'open' }>['trusted'] = [],
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (confirm === undefined) return { ok: false, message: 'Choose the port again to confirm its selection.' };
  try {
    const prepared = await call({ v: RPC_VERSION, kind: 'prepare', port });
    if (!prepared.ok) return { ok: false, message: prepared.message };
    if (prepared.kind !== 'prepare' || !(await confirm())) return { ok: false, message: 'The granted ports changed. Choose the port again.' };
    const reply = await call({ ...openRequest(port, previousSessionEnded, trusted), preparation: prepared.preparation });
    return reply.ok ? { ok: true } : { ok: false, message: reply.message };
  } catch {
    return { ok: false, message: 'The port selection could not be confirmed. Choose the port again.' };
  }
}

