/**
 * Whether another tab of this browser controls a machine while this one is not LIVE (SAFETY §4.3 Web Lock). The
 * shell keeps it from the stop paths' tab role, so the Position panel can say why its controls are not here.
 */
import { signal } from '@preact/signals';

export const observingElsewhere = signal<boolean>(false);
