/**
 * THE TRANSPORT SEAM of `machine.worker` (ROADMAP P0-14, P1-01; RUN_PLAN
 * §5.4, §8.5).
 *
 * This module is the one place where a build decides how the machine worker
 * reaches a controller. It exports exactly one function,
 * `createTransportSource`.
 *
 * - The release build (P1-01): Web Serial. `request(selector)` finds the
 *   granted port the window selected (`navigator.serial.getPorts()`, a full
 *   ordered grant snapshot match, and a unique selected USB identity;
 *   otherwise null) and hands the worker a new, unopened
 *   `WebSerialTransport` over it (packages/machine/src/webSerialTransport.ts,
 *   the one module that may touch Web Serial). The worker opens it only
 *   through `GuardedTransport`, after the prepare/confirm handshake holds
 *   this exact port (docs/safety/PORT_SELECTION.md).
 *
 *   The same artifact runs on staging and production. Since OD-29 (owner,
 *   2026-11-09) production grants `serial=(self)` to run.synthetos.com's
 *   own documents and its deploy admits the transport's chunk, as staging
 *   does; who may connect is the D1 sign-in gate's decision (accounts
 *   admits the D37 allowlist only). Every other host gets `serial=()`, so
 *   the browser refuses `getPorts()` there. Staging and the localhost bench build
 *   serve `serial=(self)`.
 * - The fake-serial TEST build (`vite build --mode fake-serial`) swaps this
 *   whole module for tools/e2e/fake-serial/transport.ts, which hands the
 *   worker a test-kit `MockSerialPort` behind a `MockTransport`
 *   (apps/web/build/fakeSerial.ts). The build puts this module in a chunk of
 *   its own (`machine-transport`), and the CI check
 *   (tools/gates/src/artifact/diff.ts) proves that the production artifact
 *   and the test artifact differ in that chunk (plus the production-only
 *   Web Serial chunk) and nowhere else.
 *
 * The fake must export `createTransportSource` with the same signature: the
 * worker chunk imports exactly that name (tools/e2e/test/fake-serial.test.ts
 * checks both modules). The fake may export more, for its own tests.
 *
 * A change to this file changes what the machine worker can reach and needs
 * safety-path review (CODEOWNERS).
 */
import type { TransportSource } from '@synthetos/machine';
import { webSerialTransportSource } from '@synthetos/machine/web-serial-transport';

export function createTransportSource(): TransportSource {
  return webSerialTransportSource();
}
