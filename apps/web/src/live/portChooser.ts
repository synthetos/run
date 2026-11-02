/**
 * The window's port chooser for LIVE entry (OD-3 "The window's port
 * chooser", approved by the owner 2026-11-02).
 *
 * THE ONE MAIN-THREAD MODULE THAT MAY IMPORT THE WEB SERIAL CHOOSER
 * (tools/gates/src/shared/webSerialNames.ts, WEB_SERIAL_CHOOSER_IMPORTER;
 * dependency-cruiser `web-serial-chooser-importers`). It turns the
 * chooser's answer into LIVE entry's `ChooseResult` with the words the
 * Connect panel shows. It never opens a port: the `PortSelector` goes to
 * the machine worker, which finds the same granted port or refuses.
 *
 * `windowChooser` calls the chooser synchronously, so the C1 confirm click
 * (live/liveEntry.ts) is still the active user gesture when the browser's
 * chooser opens.
 */
import { chooseSerialPort, type ChooserRefusal, type ChooserResult } from '@synthetos/machine/web-serial-chooser';
import type { ChooseResult } from './liveEntry.ts';

/** What the Connect panel says for each chooser refusal. */
export const CHOOSER_TEXT: Readonly<Record<ChooserRefusal, string>> = Object.freeze({
  unavailable: 'This browser has no Web Serial, so it cannot connect a machine. Use Chrome or Edge on a desktop computer.',
  cancelled: 'No port was chosen. Press Connect to try again.',
  refused: 'The browser did not show the port chooser (it needs a click on this page, and this site must be allowed to use serial ports). Press Connect to try again.',
  'no-usb-identity': 'The chosen port has no USB identity, so it cannot be connected. Choose the board’s USB serial port.',
  'not-granted': 'The browser did not grant the chosen port to this page. Press Connect to try again.',
  failed: 'The port chooser failed. Press Connect to try again.',
});

/** The LIVE entry result for one chooser answer. */
export function toChooseResult(result: ChooserResult): ChooseResult {
  return result.ok ? { ok: true, port: result.selector } : { ok: false, message: CHOOSER_TEXT[result.code] };
}

/** Shows the browser's port chooser. Call it synchronously inside the user's click. */
export function windowChooser(choose: () => Promise<ChooserResult> = chooseSerialPort): Promise<ChooseResult> {
  return choose().then(toChooseResult);
}
