/**
 * RTS held on after every port open (OD-33; SAFETY H61 as amended 2026-11-10; TinyG B-FC-1).
 *
 * A TinyG with `$ex=2` (RTS/CTS) holds all of its output while the host's RTS is off: a `{stat}` GET got no answer
 * within 2 s on the bench, and the held bytes came out once RTS was turned on again. With RTS on, run's
 * `flowControl: 'none'` plus line mode streamed a 296-segment circle clean on 450.02 (bench 3) and on edge-next
 * (bench 2): line mode keeps the unanswered bytes far below the board's RTS marks. So every open, the session's,
 * a reconnect's and the flasher's bootloader reopen, turns RTS on explicitly instead of trusting the browser's or
 * the OS's default. DTR is never touched (a DTR change can reset some boards). A port whose RTS cannot be set is
 * closed again and the link is refused, in plain words.
 *
 * The rule lives here. The fake-serial test build's `MockTransport.open` calls `openWithRts`. `WebSerialTransport`
 * (every production open) holds the same steps and words as literals, because that module imports types only
 * (dependency-cruiser `web-serial-transport-type-imports-only`); test/rts.test.ts pins the two equal.
 */

/** The only output signal run sets after an open. `dataTerminalReady` is left out on purpose: DTR is never touched. */
export const RTS_ON: Readonly<{ requestToSend: true }> = Object.freeze({ requestToSend: true });

/** What the user reads when RTS cannot be set (after "the port was not opened: "). */
export const RTS_REFUSAL = 'Run couldn’t turn on the port’s RTS line, and the board may send nothing without it. Unplug the board, plug it back in, then connect again.';

/** The parts of a serial port `openWithRts` uses: Web Serial's `setSignals` and `close`. */
export interface RtsPort {
  setSignals(signals: { readonly requestToSend: true }): Promise<void>;
  close(): Promise<void>;
}

/** RTS could not be turned on after the port opened; the port was closed again. */
export class RtsRefusedError extends Error {
  constructor(cause: unknown) {
    super(RTS_REFUSAL, { cause });
    this.name = 'RtsRefusedError';
  }
}

/**
 * Runs `open` (the port's own open), then turns RTS on. If RTS cannot be set, the port is closed (a close failure is
 * ignored: the port is unusable either way) and `RtsRefusedError` is thrown. An `open` failure is passed on as it is.
 */
export async function openWithRts(port: RtsPort, open: () => Promise<void>): Promise<void> {
  await open();
  try {
    await port.setSignals(RTS_ON);
  } catch (error) {
    await port.close().catch(() => undefined);
    throw new RtsRefusedError(error);
  }
}
