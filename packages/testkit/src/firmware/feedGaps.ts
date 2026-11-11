/** Coarse supply-gap telemetry, not a planner model. @behaviour EN-FEED-LIMIT-STEP3
 * @cite EN3 runtime.c:539-620,652-685. See LIM-EN-FEED-LIMIT-STEP3 for omitted timing/cause accounting.
 */
import '../marker.ts';
export class FeedGaps {
  enabled = false;
  job: 0 | 1 = 0;
  moved = false;
  line = 0;
  #at = 0;
  #cls: 0 | 1 | 2 = 0;
  #open = false;
  #ms = [0, 0];
  #count = 0;
  #last = -1;

  window(now: number): void {
    this.#at = now;
    this.#cls = 0;
    this.#open = false;
    this.#ms = [0, 0];
    this.#count = 0;
    this.#last = -1;
    this.moved = false;
  }
  setJob(value: 0 | 1, now: number): void {
    if (this.job === value) return;
    this.#credit(now);
    this.job = value;
    this.moved = false;
    this.#open = false;
    this.#cls = 0;
  }
  #credit(now: number): void {
    if (this.#cls > 0) this.#ms[this.#cls - 1] = (this.#ms[this.#cls - 1] ?? 0) + Math.max(0, now - this.#at);
    this.#at = now;
  }
  tick(now: number, state: { off: boolean; paused: boolean; drained: boolean; pending: boolean }): string | null {
    this.#credit(now);
    let next: 0 | 1 | 2 = 0;
    if (state.off || this.job === 0) { this.moved = false; this.#open = false; }
    else if (this.moved && !state.paused) {
      if (state.drained) {
        next = state.pending ? 1 : 2;
        if (!this.#open) this.#count++;
        this.#open = true;
      } else this.#open = false;
    }
    this.#cls = next;
    if (this.#last === next) return null;
    this.#last = next;
    return JSON.stringify({ fl: { k: 0, m: 0, p: null, n: next === 0 ? null : this.line, ...(next === 0 ? {} : { g: next }) } });
  }
  frame(e: number, q: number): string {
    return JSON.stringify({ fg: { e, q, g: [...this.#ms.map(Math.floor), this.#count], b: [[0, 0], [0, 0], [0, 0]] } });
  }
}
