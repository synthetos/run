/**
 * The workspace root's lock (spec §5.3): `inert` while the page's gate is anything but open. The prop serves the
 * prerender and the string-rendered tests; the effect owns the live attribute, because Preact's hydrate does not
 * diff props and a hosted page hydrates already locked (session still being read).
 */
import type { RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { applyLock, lockProps } from './gateState.ts';
import { pageGate } from './SignInGate.ts';

export function useShellLock(): { readonly ref: RefObject<HTMLDivElement | null>; readonly lock: { readonly inert?: true } } {
  const lock = lockProps(pageGate());
  const locked = lock.inert === true;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    applyLock(ref.current, locked);
  }, [locked]);
  return { ref, lock };
}
