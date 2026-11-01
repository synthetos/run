/**
 * Seeded pseudo-random numbers for fault plans (ROADMAP P0-11, RUN_PLAN §8.1
 * "Determinism: the same seed and fault plan give byte-identical transcripts").
 *
 * xoshiro128** seeded through splitmix32. Only 32-bit integer operations
 * (`Math.imul`, shifts, `>>> 0`) are used, so the sequence is the same on
 * every JavaScript engine. `Math.random` is never used anywhere in the kit.
 */

export class SeededRng {
  #s0: number;
  #s1: number;
  #s2: number;
  #s3: number;
  readonly seed: number;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) throw new RangeError(`seed must be a safe integer, got ${seed}`);
    this.seed = seed;
    let x = (seed ^ Math.floor(seed / 0x1_0000_0000)) >>> 0;
    const next = (): number => {
      // splitmix32
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.#s0 = next();
    this.#s1 = next();
    this.#s2 = next();
    this.#s3 = next();
    if ((this.#s0 | this.#s1 | this.#s2 | this.#s3) === 0) this.#s0 = 1; // the all-zero state is a fixed point
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.#s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.#s1 << 9) >>> 0;
    this.#s2 = (this.#s2 ^ this.#s0) >>> 0;
    this.#s3 = (this.#s3 ^ this.#s1) >>> 0;
    this.#s1 = (this.#s1 ^ this.#s2) >>> 0;
    this.#s0 = (this.#s0 ^ this.#s3) >>> 0;
    this.#s2 = (this.#s2 ^ t) >>> 0;
    this.#s3 = rotl(this.#s3, 11);
    return result;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / 0x1_0000_0000;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new RangeError(`int(n) needs a positive integer, got ${n}`);
    return Math.floor(this.next() * n);
  }

  /** True with probability p. p = 0 never draws true and p = 1 always does. */
  chance(p: number): boolean {
    if (!(p >= 0 && p <= 1)) throw new RangeError(`probability must be in [0, 1], got ${p}`);
    return this.next() < p;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
