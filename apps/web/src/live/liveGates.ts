/**
 * The window-side gate for user requests while connected (ROADMAP P1-05;
 * RUN_PLAN §2.2; SAFETY H27).
 *
 * - Never-gated actions (Pause, Stop job, Spindle/coolant off now, Reset
 *   controller, Disconnect, the recovery card) are allowed here at once,
 *   with no identity or advisory read. They remain subject to the
 *   session's allow-matrix in machine.worker, which this module never
 *   replaces.
 * - Actions in G need an identity (AuthGate). Arm/Start and jog are also
 *   refused while the advisory poll is blocking (a revocation, or an
 *   advisory that can no longer be verified).
 *
 * A refusal here only stops a new request from being sent. Nothing here
 * sends anything to the machine worker, so a running job, a hold and every
 * stop are untouched by an identity loss or a revocation.
 */
import type { AdvisoryCheck } from './advisoryGate.ts';
import type { AuthGate, GatedAction, NeverGatedAction } from './authGate.ts';
import { NEVER_GATED } from './authGate.ts';

export type LiveAction = GatedAction | NeverGatedAction;

export type LiveDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: 'signed-out' | 'advisory'; readonly advisory?: AdvisoryCheck };

const ADVISORY_GATED: readonly GatedAction[] = ['armOrStart', 'jog'];

export class LiveGates {
  private readonly auth: AuthGate;
  private readonly advisoryBlocked: () => AdvisoryCheck | null;

  constructor(auth: AuthGate, advisoryBlocked: () => AdvisoryCheck | null) {
    this.auth = auth;
    this.advisoryBlocked = advisoryBlocked;
  }

  async check(action: LiveAction): Promise<LiveDecision> {
    if ((NEVER_GATED as readonly string[]).includes(action)) return { allowed: true };
    const gated = action as GatedAction;
    if (ADVISORY_GATED.includes(gated)) {
      const blocked = this.advisoryBlocked();
      if (blocked !== null) return { allowed: false, reason: 'advisory', advisory: blocked };
    }
    const decision = await this.auth.check(gated);
    return decision.allowed ? { allowed: true } : { allowed: false, reason: 'signed-out' };
  }
}
