import { bannedNamesRule } from './bannedNames.ts';

/**
 * The network API identifiers banned on the machine path (ROADMAP P0-02,
 * SAFETY §8 item 22, T-S57): the network is never in the motion or stop path
 * (SAFETY §4.10), and `machine.worker` has no network code (RUN_PLAN §5.4).
 */
export const NETWORK_IDENTIFIERS: readonly string[] = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'sendBeacon',
];

export const noNetworkApi = bannedNamesRule({
  description: 'Ban network API identifiers in the machine-path packages (SAFETY §8 item 22, T-S57).',
  names: NETWORK_IDENTIFIERS,
  message:
    "'{{name}}' is a network API and is banned in this package: the network is never in the motion or stop " +
    'path (SAFETY §4.10, §8 item 22, T-S57). Network code lives only in apps/web/src/cloud.',
});
