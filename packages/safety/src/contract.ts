/**
 * SAFETY §7, "What the software cannot guarantee". SAFETY.md says: "Show
 * this list verbatim on run.synthetos.com/safety/." The safety page renders
 * it from here, and `test/contract.test.ts` fails unless these items equal
 * the in-repo SAFETY.md §7 byte for byte, in order.
 *
 * Pure data. Changing it needs safety-path review (SAFETY §8).
 */
export const CANNOT_GUARANTEE: readonly string[] = Object.freeze([
  'It cannot stop your machine in an emergency. Only a hardwired E-stop can.',
  'It cannot guarantee that a stop command arrives or how quickly it arrives. The command passes through the browser, the operating system, USB and the firmware.',
  'It cannot stop the machine if the browser tab closes, crashes, is discarded or sleeps, or if USB is lost. The controller keeps running its queued moves.',
  'It cannot turn off a spindle, laser or coolant if the controller does not obey or the link is lost. On TinyG a feedhold, a program stop (M0/M1) or a tool change (M6) leaves the spindle running.',
  'It cannot see your wiring, your switches, your workpiece or the people around the machine.',
  'Its preview and bounds checks use its own interpreter and can disagree with the firmware.',
  'It cannot detect mechanical faults: lost steps, loose couplers, broken switch wires.',
  'A completed bring-up journey records what you attested and what small tests showed. It does not mean the machine is safe.',
  'Your account stores files and settings. It does not make them correct or safe for a machine. Review every change before you use it.',
  'It is not certified to any safety standard.',
  'It cannot protect you if the code served at run.synthetos.com is itself replaced by an attacker. Keep your E-stop within reach.',
]);
