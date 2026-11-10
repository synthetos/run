/**
 * The updater targets, keyed by board family (core/updater.ts). Adding a target is a new folder under targets/
 * and one row here (see the package README for `samba-sam3x`).
 */
import type { BoardFamily } from '../core/updater.ts';
import { xbootXmega } from './xboot-xmega/updater.ts';

export const UPDATER_TARGETS = Object.freeze({
  'tinyg-xmega': xbootXmega,
} satisfies Record<BoardFamily, unknown>);

/** The target for a board family, or null when the flasher does not know the family. */
export function updaterFor(family: string): (typeof UPDATER_TARGETS)[BoardFamily] | null {
  return Object.prototype.hasOwnProperty.call(UPDATER_TARGETS, family) ? UPDATER_TARGETS[family as BoardFamily] : null;
}
