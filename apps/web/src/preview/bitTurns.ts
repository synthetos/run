/**
 * Whether the 3D drawing turns the bit while the spindle runs (gcode-view markerSpin.ts): false on a software
 * renderer, which never spends frames on it. The viewer's bar shows "↻ Spindle on" instead whenever the bit does
 * not turn (that, or reduced motion). Preview3D sets it when it makes its renderer.
 */
import { signal } from '@preact/signals';

export const bitTurns = signal(true);
