/**
 * Play preview's clock (owner, 2026-11-09; SAFETY H15 and T-S41 amended): playing, paused, a speed of 1×, 2×,
 * 5× or 10×, and the time into the file, from a clock it is given. It stops at the end. Pure apart from its own
 * state; the page drives the frames and decides when Play may be offered (never while a job runs or the board
 * moves). It knows nothing of the machine.
 */

/** The speeds the page offers; Play starts at 1×. */
export const PLAY_SPEEDS = [1, 2, 5, 10] as const;
export type PlaySpeed = (typeof PLAY_SPEEDS)[number];

export interface Player {
  readonly playing: boolean;
  readonly speed: PlaySpeed;
  /** Seconds into the file now. */
  time(): number;
  readonly ended: boolean;
  play(): void;
  pause(): void;
  setSpeed(speed: PlaySpeed): void;
  /** Moves to a time (the scrubber); keeps playing or paused as it was. */
  seek(seconds: number): void;
}

export function createPlayer(total: number, now: () => number): Player {
  let playing = false;
  let speed: PlaySpeed = 1;
  /** The time into the file at `clock`, the clock reading (ms) when it was taken. */
  let anchor = 0;
  let clock = 0;
  const current = (): number => (playing ? Math.min(total, anchor + ((now() - clock) / 1000) * speed) : anchor);
  const rebase = (): void => {
    anchor = current();
    clock = now();
  };
  return {
    get playing() {
      if (playing && current() >= total) {
        anchor = total;
        playing = false;
      }
      return playing;
    },
    get speed() {
      return speed;
    },
    time: current,
    get ended() {
      return current() >= total;
    },
    play() {
      if (playing) return;
      // Playing from the end starts again.
      if (anchor >= total) anchor = 0;
      clock = now();
      playing = true;
    },
    pause() {
      rebase();
      playing = false;
    },
    setSpeed(next) {
      rebase();
      speed = next;
    },
    seek(seconds) {
      anchor = Math.max(0, Math.min(total, seconds));
      clock = now();
    },
  };
}
