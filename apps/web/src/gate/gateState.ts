/**
 * The sign-in front door's decision (docs/superpowers/specs/2026-11-16-first-run-design.md §5.1): from the page's
 * account state and whether this is a hosted origin, one gate kind.
 *
 * - `open`: the workspace is usable.
 * - `checking`: hosted origin, session not read yet: scrim only, so the workspace never flashes usable.
 * - `sign-in`: the session read offers sign-in and nobody is signed in: the dialog with the GitHub button.
 * - `not-offered`: hosted origin where the Worker does not offer sign-in yet: locked, "opens soon".
 * - `unavailable`: hosted origin and the session read failed: locked, with the retry line.
 *
 * A non-hosted origin (bench, localhost) locks only on `sign-in`, so a local page without accounts stays open.
 * This is never the Worker's gate: authGate.ts decides every gated request; this only decides what the page shows.
 */
import { environmentForOrigin } from '@synthetos/protocol';
import type { AccountState } from '../live/account.ts';

export type GateKind = 'open' | 'checking' | 'sign-in' | 'not-offered' | 'unavailable';

const HOSTED: Readonly<Record<AccountState['status'], GateKind>> = Object.freeze({
  'signed-in': 'open', 'signed-out': 'not-offered', checking: 'checking', unavailable: 'unavailable',
});

export function gateState(state: AccountState, hosted: boolean): GateKind {
  if (state.status === 'signed-out' && state.signIn) return 'sign-in';
  return hosted ? HOSTED[state.status] : 'open';
}

/** True for the two hosted origins (run.synthetos.com, staging.run.synthetos.com). */
export function hostedOrigin(origin: string): boolean {
  return environmentForOrigin(origin) !== null;
}

/** Props for the workspace root: `inert` for every locked kind. */
export function lockProps(kind: GateKind): { readonly inert?: true } {
  return kind === 'open' ? {} : { inert: true };
}

/**
 * Writes the lock on the element itself. Preact's hydrate does not diff props, so a hosted page that hydrates
 * while the session is still being read never gets its `inert` from the prop alone; AppShell applies it in an
 * effect whenever the lock changes, mount included.
 */
export function applyLock(el: { inert: boolean } | null, locked: boolean): void {
  if (el !== null) el.inert = locked;
}
