/**
 * What every firmware target of the flasher provides (the modular updater, owner 2026-11-09). A target is one
 * bootloader on one board family: today TinyG's xboot on the ATxmega192A3 (`targets/xboot-xmega/`); later g2core's
 * SAM-BA on the SAM3X (`samba-sam3x`, see the package README).
 *
 * The five steps, in the order a flash runs them:
 * - `prepare`: check an image for this target (format, part, size) and plan what is written. No board needed.
 * - `detect`: find the bootloader on an open byte link (core/link.ts) and identify the chip.
 * - `write`: back up what is on the board, hand the backups to the caller (nothing is written until they are
 *   stored), then write the plan. Never throws: a failure is the outcome.
 * - `verify`: whether a write's outcome proves the board holds exactly the image.
 * - `restore`: the plan that writes a firmware image backup back, bit for bit.
 *
 * The gate in front of every target (authorize.ts and the bootloader capability) is not part of a target: no
 * target can open a bootloader port without it. Pure types; nothing here touches a port.
 */
import type { ByteLink, FlasherClock } from './link.ts';

/** A board family the flasher knows (the key of the target table, targets/index.ts). */
export type BoardFamily = 'tinyg-xmega';

/** A step's progress: what it is doing, how far, and of how much (bytes or pages, as the target says). */
export interface UpdaterProgress<Phase extends string = string> {
  readonly phase: Phase;
  readonly done: number;
  readonly of: number;
  readonly note?: string;
}

export type Prepared<Plan> = { readonly ok: true; readonly plan: Plan } | { readonly ok: false; readonly reason: string };

export interface Updater<Session, Identity, Plan, Hooks, Options, Outcome, Backup> {
  readonly family: BoardFamily;
  /** The bootloader in plain words, for the hub and the logs ("TinyG xboot (AVR109)"). */
  readonly bootloader: string;
  prepare(imageText: string): Prepared<Plan>;
  detect(link: ByteLink, clock: FlasherClock, deadlineMs: number): Promise<{ readonly session: Session; readonly identity: Identity }>;
  write(session: Session, plan: Plan, hooks: Hooks, options: Options): Promise<Outcome>;
  verify(outcome: Outcome): boolean;
  restore(backup: Backup): Prepared<Plan>;
}
