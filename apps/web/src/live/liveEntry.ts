/**
 * LIVE entry (ROADMAP P1-05; SAFETY §3 NOT_CONNECTED → PORT_REQUEST, §4.1
 * "Enter LIVE", H27; RUN_PLAN §2.2).
 *
 * Connect is refused unless, in this order:
 * 1. the D1 sign-in gate has an identity (AuthGate, `connect`);
 * 2. the signed safety advisory verifies and does not revoke this build
 *    (advisoryGate.ts: fetched now, or a cached copy younger than 7 days);
 * 3. C1 is accepted, once per browser (c1.ts; OD-30, owner 2026-11-09).
 * Only then is the port opened. The port chooser needs a user gesture
 * (`requestPort()`): the first time it is shown from the C1 confirm click;
 * after that, when this browser has accepted C1 before, from the Connect
 * click itself, before any await. Then fullscreen is left and the worker is
 * asked to open the port. A started session writes the `liveSession`
 * marker (W6) and starts the 15-minute advisory poll.
 *
 * The audible alarm is unlocked synchronously inside the Connect click,
 * before any await (P1-04, T-S30).
 *
 * Nothing here is consulted by the machine worker, and nothing here sends
 * the worker anything but `open`: a refusal only means no session starts.
 */
import type { AdvisoryCheck } from './advisoryGate.ts';
import { signInAvailable, type AuthGate } from './authGate.ts';
import { c1Checklist, c1FormFor, recordC1, type C1Form } from './c1.ts';
import type { DeviceSafetyStore } from './deviceSafety.ts';
import { markLive } from './liveMarker.ts';
import type { MachineRequest } from '../machine-worker/rpc.ts';

export type PortChoice = Extract<MachineRequest, { kind: 'open' }>['port'];

export type EntryRefusal =
  /** `signIn`: false where no provider can ever sign in (production until accounts ship): the panel says so plainly. */
  | { readonly kind: 'signed-out'; readonly signIn: boolean }
  | { readonly kind: 'advisory'; readonly check: Exclude<AdvisoryCheck, { ok: true }> }
  | { readonly kind: 'c1-incomplete' }
  | { readonly kind: 'no-port'; readonly message: string }
  | { readonly kind: 'open-failed'; readonly message: string };

export type EntryState =
  | { readonly step: 'idle' }
  | { readonly step: 'checking' }
  | { readonly step: 'c1'; readonly form: C1Form; readonly boxes: number }
  | { readonly step: 'opening' }
  | { readonly step: 'live' }
  | { readonly step: 'refused'; readonly refusal: EntryRefusal };

export type ChooseResult = { readonly ok: true; readonly port: PortChoice; readonly confirm?: () => Promise<boolean>; readonly release?: () => void } | { readonly ok: false; readonly message: string };
export type OpenResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface LiveEntryDeps {
  readonly auth: AuthGate;
  readonly checkAdvisory: () => Promise<AdvisoryCheck>;
  readonly store: DeviceSafetyStore;
  readonly now: () => Date;
  /** Shows the port chooser. Called synchronously inside the C1 confirm click. */
  readonly choosePort: () => Promise<ChooseResult>;
  readonly open: (port: PortChoice, confirm?: () => Promise<boolean>) => Promise<OpenResult>;
  readonly leaveFullscreen: () => Promise<unknown>;
  /** Must not await (it runs inside the Connect gesture). */
  readonly unlockAlarm: () => void;
  /** A session started: start the advisory poll. */
  readonly onLive: () => void;
}

export class LiveEntry {
  #state: EntryState = { step: 'idle' };
  readonly #listeners = new Set<(s: EntryState) => void>();

  private readonly deps: LiveEntryDeps;

  constructor(deps: LiveEntryDeps) {
    this.deps = deps;
  }

  get state(): EntryState {
    return this.#state;
  }

  subscribe(listener: (s: EntryState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(state: EntryState): void {
    this.#state = state;
    for (const l of this.#listeners) l(state);
  }

  #refuse(refusal: EntryRefusal): void {
    this.#set({ step: 'refused', refusal });
  }

  /** The Connect click. */
  async begin(): Promise<void> {
    if (this.#state.step === 'checking' || this.#state.step === 'opening' || this.#state.step === 'live') return;
    // Synchronously, inside the gesture, before any await (T-S30).
    this.deps.unlockAlarm();
    this.#set({ step: 'checking' });
    const auth = await this.deps.auth.check('connect');
    if (!auth.allowed) return this.#refuse({ kind: 'signed-out', signIn: signInAvailable(this.deps.auth.providers) });
    const advisory = await this.deps.checkAdvisory();
    if (!advisory.ok) return this.#refuse({ kind: 'advisory', check: advisory });
    const form = await c1FormFor(this.deps.store);
    // Identity checks are asynchronous. A plain Choose port click gives the chooser fresh activation;
    // an already accepted C1 stays accepted, with no repeated checklist.
    this.#set({ step: 'c1', form, boxes: c1Checklist(form).boxes.length });
  }

  /** The C1 confirm click, with the state of every box. */
  async confirm(ticked: readonly boolean[]): Promise<void> {
    const state = this.#state;
    if (state.step !== 'c1') return;
    if (ticked.length !== state.boxes || !ticked.every((t) => t)) return this.#refuse({ kind: 'c1-incomplete' });
    // The chooser first and synchronously: it needs this click's user activation.
    const choice = this.deps.choosePort();
    return this.#open(choice, state.form);
  }

  /** Opens the chosen port, after C1 (accepted now, or once before in this browser). */
  async #open(choice: Promise<ChooseResult>, form: C1Form): Promise<void> {
    void this.deps.leaveFullscreen().catch(() => undefined);
    this.#set({ step: 'opening' });
    try {
      await recordC1(this.deps.store, form, this.deps.now());
    } catch {
      // Not recorded: the next Connect shows the full list again, which is the safe side.
    }
    const chosen = await choice.catch((): ChooseResult => ({ ok: false, message: 'The port chooser failed.' }));
    if (!chosen.ok) return this.#refuse({ kind: 'no-port', message: chosen.message });
    let opened: OpenResult;
    try {
      // The session can change while the chooser is open. Refusal still releases its watcher.
      const auth = await this.deps.auth.check('connect');
      if (!auth.allowed) return this.#refuse({ kind: 'signed-out', signIn: signInAvailable(this.deps.auth.providers) });
      opened = await this.deps.open(chosen.port, chosen.confirm);
    } finally {
      // Ends the chooser's connect/disconnect guard on every exit (confirmed, refused, failed or thrown).
      chosen.release?.();
    }
    if (!opened.ok) return this.#refuse({ kind: 'open-failed', message: opened.message });
    try {
      await markLive(this.deps.store, this.deps.now());
    } catch {
      // The marker could not be written; the session still runs under its own rules.
    }
    this.#set({ step: 'live' });
    this.deps.onLive();
  }

  /** Back to NOT CONNECTED (C1 cancelled, a refusal dismissed, or after Disconnect). C1 must be accepted again. */
  reset(): void {
    if (this.#state.step === 'opening' || this.#state.step === 'checking') return;
    this.#set({ step: 'idle' });
  }
}
