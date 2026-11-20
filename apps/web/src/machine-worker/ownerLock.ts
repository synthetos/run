/**
 * Which machine locks are this tab's own (owner report 2026-11-19; SAFETY
 * §4.3 "Web Lock", H55).
 *
 * The tab whose worker holds `synthetos-machine:<board id>` controls that
 * board, LIVE or not: the firmware path connects without LIVE entry, and a
 * Connect holds the lock while it is still opening. The lock query cannot
 * say which context holds a lock, so the machine worker also holds
 * `synthetos-tab:<tab token>:<machine lock>` for exactly as long as it holds
 * the machine lock: taken before, let go after (machineLock.ts). One query
 * then shows which machine locks are the tab's own, with no race: the owner
 * lock and the machine lock must have the same holder.
 *
 * The token is random per page load and travels in the worker's name.
 */
import { isMachineLockName, type LockManagerLike } from './stopChannel.ts';

export const OWNER_LOCK_PREFIX = 'synthetos-tab:';
const TOKEN = /^[A-Za-z0-9-]{1,64}$/;

export function ownerLockName(owner: string, machine: string): string {
  return `${OWNER_LOCK_PREFIX}${owner}:${machine}`;
}

/** The tab token in a machine worker's name (`machine:<token>`), or null. */
export function workerOwner(name: string | undefined): string | null {
  const token = name?.split(':')[1];
  return token !== undefined && TOKEN.test(token) ? token : null;
}

export interface MachineLockSplit {
  /** Machine locks held by another tab (or by no known owner), sorted. */
  readonly others: string[];
  /** Machine locks this tab's own worker holds, sorted. */
  readonly own: string[];
}

/**
 * The machine locks held in this browser, split into this tab's own and the others, or null when the locks
 * cannot be read. A machine lock is own only when this tab's owner lock for it is held by the same holder
 * (`clientId`): while this worker's request for a lock another tab holds is refused, its owner lock is held
 * for a moment, and the other tab's lock must still read as another tab's. Null owner: every lock is another's.
 */
export async function splitMachineLocks(locks: LockManagerLike | null, owner: string | null): Promise<MachineLockSplit | null> {
  if (locks === null) return null;
  let held: readonly { readonly name?: string; readonly clientId?: string }[];
  try {
    held = (await locks.query()).held ?? [];
  } catch {
    return null;
  }
  const holders = new Map(held.filter((l) => typeof l.name === 'string').map((l) => [l.name as string, l.clientId]));
  const machines = [...holders.keys()].filter(isMachineLockName).sort();
  const mine = (name: string): boolean => owner !== null && holders.has(ownerLockName(owner, name)) && holders.get(ownerLockName(owner, name)) === holders.get(name);
  return { others: machines.filter((n) => !mine(n)), own: machines.filter(mine) };
}
