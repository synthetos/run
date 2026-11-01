/**
 * THE TRANSPORT SEAM of `machine.worker` (ROADMAP P0-14, RUN_PLAN §8.5).
 *
 * This module is the one place where a build decides how the machine worker
 * reaches a controller. It exports exactly one function,
 * `createTransportSource`, and has no runtime imports.
 *
 * - Production, Phase 0: there is no transport. `request()` always resolves
 *   null, so the worker answers every `open` with `unavailable`. Nothing in
 *   Phase 0 can reach a serial port (ROADMAP P0-02, P0-13).
 * - Production, P1-01: this body returns a source backed by
 *   `WebSerialTransport`, in its own owner-approved PR.
 * - The fake-serial TEST build (`vite build --mode fake-serial`) swaps this
 *   whole module for tools/e2e/fake-serial/transport.ts, which hands the
 *   worker a test-kit `MockSerialPort` behind a `MockTransport`
 *   (apps/web/build/fakeSerial.ts). The build puts this module in a chunk of
 *   its own (`machine-transport`), and the CI check
 *   (tools/gates/src/artifact/diff.ts) proves that the production artifact
 *   and the test artifact differ in that chunk and nowhere else.
 *
 * Keep the export list identical to the fake's: the worker chunk imports it
 * by name, and a different export list would change the worker chunk too.
 */
import type { TransportSource } from '@synthetos/machine';

export function createTransportSource(): TransportSource {
  return Object.freeze({ kind: 'none', request: () => Promise.resolve(null) });
}
