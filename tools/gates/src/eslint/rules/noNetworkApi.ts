import { NETWORK_IDENTIFIERS } from '../../shared/networkIdentifiers.ts';
import { bannedNamesRule } from './bannedNames.ts';

/**
 * The list lives in a dependency-free module shared with the bundle scan
 * (ROADMAP P0-03). It is re-exported here for the rule's tests.
 */
export { NETWORK_IDENTIFIERS };

export const noNetworkApi = bannedNamesRule({
  description: 'Ban network API identifiers in the machine-path packages (SAFETY §8 item 22, T-S57).',
  names: NETWORK_IDENTIFIERS,
  message:
    "'{{name}}' is a network API and is banned in this package: the network is never in the motion or stop " +
    'path (SAFETY §4.10, §8 item 22, T-S57). Network code lives only in apps/web/src/cloud.',
});
