/**
 * The network API identifiers that may never appear on the machine path
 * (ROADMAP P0-02, SAFETY §8 item 22, T-S57) and never in the built web
 * bundle outside the cloud client (ROADMAP P0-03, RUN_PLAN §6.2).
 *
 * This module has no dependencies, so the `build` CI job can run the bundle
 * scan without installing any dev tooling. The ESLint rule `run/no-network-api`
 * and the bundle scan both read this one list.
 */
export const NETWORK_IDENTIFIERS: readonly string[] = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'sendBeacon',
];
