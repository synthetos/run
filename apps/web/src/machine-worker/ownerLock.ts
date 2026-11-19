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
 * then shows which machine locks are the tab's own, with no race.
 *
 * The token is random per page load and travels in the worker's name.
 */
import { MACHINE_LOCK_PREFIX, type LockManagerLike } from './stopChannel.ts';

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

/**
 * A view of `locks` whose query leaves out the machine locks this tab's own
 * worker holds. Requests pass through. Null owner or null locks: unchanged.
 */
export function othersOnly(locks: LockManagerLike | null, owner: string | null): LockManagerLike | null {
  if (locks === null || owner === null) return locks;
  const mine = `${OWNER_LOCK_PREFIX}${owner}:`;
  return {
    request: (name, options, callback) => locks.request(name, options, callback),
    query: async () => {
      const held = (await locks.query()).held ?? [];
      const own = new Set(held.map((l) => l.name).filter((n): n is string => typeof n === 'string' && n.startsWith(mine)).map((n) => n.slice(mine.length)));
      return { held: held.filter((l) => !(typeof l.name === 'string' && l.name.startsWith(MACHINE_LOCK_PREFIX) && own.has(l.name))) };
    },
  };
}
