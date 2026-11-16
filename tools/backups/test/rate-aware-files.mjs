import { FakeFiles } from './files-fixture.mjs';

/** Models the documented per-key write rate without real waits. */
export class RateAwareFiles extends FakeFiles {
  lastWrites = new Map(); attempts = []; clock;
  constructor(clock) { super(); this.clock = clock; }
  async put(key, ...args) {
    const at = this.clock.now();
    this.attempts.push({ key, at });
    if (this.lastWrites.has(key) && at - this.lastWrites.get(key) < 1000) throw Object.assign(new Error('R2 429: same-key write rate'), { status: 429 });
    const result = await super.put(key, ...args);
    this.lastWrites.set(key, this.clock.now());
    return result;
  }
}
