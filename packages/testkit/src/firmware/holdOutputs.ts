/** E060 output latch and restart delay. Source: ee98f02b canonical_machine.c:2167-2241.
 * The model uses virtual milliseconds; the firmware adds one 10 ms RTC tick.
 */
export interface HoldOutputs { spindle: 'off' | 'cw' | 'ccw'; mist: boolean; flood: boolean }
export class HoldOutputLatch {
  #saved: HoldOutputs | null = null;
  #until: number | null = null;
  get captured(): boolean { return this.#saved !== null; }
  clear(): void { this.#saved = null; this.#until = null; }
  pause(current: HoldOutputs, spindle: boolean, coolant: boolean): HoldOutputs {
    this.#saved ??= { spindle: spindle ? current.spindle : 'off', mist: coolant && current.mist, flood: coolant && current.flood };
    const resumed = this.#until !== null;
    this.#until = null;
    return { spindle: spindle || (resumed && this.#saved.spindle !== 'off') ? 'off' : current.spindle, mist: coolant ? false : current.mist, flood: coolant ? false : current.flood };
  }
  resume(current: HoldOutputs, now: number, seconds: number): { outputs: HoldOutputs; ready: boolean } {
    const saved = this.#saved;
    if (saved === null) return { outputs: current, ready: true };
    this.#until ??= now + (saved.spindle !== 'off' && seconds > 0 ? Math.ceil(seconds * 1000) + 10 : 0);
    const ready = now >= this.#until;
    const outputs = { spindle: saved.spindle === 'off' ? current.spindle : saved.spindle, mist: current.mist || (ready && saved.mist), flood: current.flood || (ready && saved.flood) };
    if (ready) this.clear();
    return { outputs, ready };
  }
}
