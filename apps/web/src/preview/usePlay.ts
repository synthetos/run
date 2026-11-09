/**
 * Play preview as a hook (owner, 2026-11-09: "play preview should just play the gcode and the movements"; SAFETY
 * H15 and T-S41 amended, OD-25): the tool moves along the file's moves at programmed speeds (gcode-view play/),
 * at 1×, 2×, 5× or 10×, with pause and the scrubber working any time. The page offers it only when allowed
 * (`allowed`: no job of this tab and no board in motion); when that ends it stops at once. Under reduced motion
 * it does not run on its own: "Next move" steps one move at a time.
 *
 * The tool's position goes to the drawing every frame through a feed (no page re-render); the lines done go to
 * the page a few times a second (the scrubber, the highlight and the carve follow them). Display only: nothing
 * here reaches the machine.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { buildTimeline, createPlayer, lineStartTime, pointAt, programmedTiming, type PlaySpeed, type Player, type SegmentList, type Timeline, type TimingProvider, type Vec3 } from '@synthetos/gcode-view';

export interface PlayFeed {
  /** Adds a listener for the play tool's position (null when not playing); it hears the current one at once. */
  subscribe(listener: (pos: Vec3 | null) => void): () => void;
}

export interface PlayView {
  /** Play can be offered now: a drawn file, and allowed. */
  readonly available: boolean;
  /** A play session: playing, or paused part way. */
  readonly active: boolean;
  readonly playing: boolean;
  readonly speed: PlaySpeed;
  /** List lines done (a few times a second). */
  readonly completed: number;
  /** The page asks for reduced motion: Play steps instead of running. */
  readonly reducedMotion: boolean;
  readonly feed: PlayFeed;
  play(): void;
  pause(): void;
  setSpeed(speed: PlaySpeed): void;
  /** Puts the tool at the start of list line `line` (the scrubber). */
  seekLine(line: number): void;
  /** Ends the session: the play tool goes. */
  stop(): void;
  /** Moves to the end of the next move (reduced motion). */
  step(): void;
}

export interface PlayInput {
  readonly segments: SegmentList | null;
  readonly feeds: Float32Array | null;
  readonly allowed: boolean;
  /** The timing to play at (the seam for predicted speeds later); default: programmed speeds. */
  readonly timing?: TimingProvider | null;
  /** The rapid rate for programmed speeds, mm/min (the machine's), or undefined for the stated default. */
  readonly rapidMmPerMin?: number;
  /** Lines done changed (throttled): the page moves the scrubber. */
  readonly onLines?: (completed: number) => void;
  readonly now?: () => number;
}

/** Lines-done updates to the page at most this often, ms. */
const LINES_EVERY_MS = 120;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function usePlay({ segments, feeds, allowed, timing = null, rapidMmPerMin, onLines, now = () => performance.now() }: PlayInput): PlayView {
  const timeline = useMemo<Timeline | null>(() => {
    if (segments === null || feeds === null) return null;
    const provider = timing ?? programmedTiming(feeds, rapidMmPerMin);
    return buildTimeline(provider.durations(segments));
  }, [segments, feeds, timing, rapidMmPerMin]);
  const player = useRef<Player | null>(null);
  const listeners = useRef(new Set<(pos: Vec3 | null) => void>());
  const position = useRef<Vec3 | null>(null);
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaySpeed>(1);
  const [completed, setCompleted] = useState(0);
  const onLinesRef = useRef(onLines);
  onLinesRef.current = onLines;
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const available = allowed && timeline !== null && timeline.total > 0;

  const tell = (pos: Vec3 | null): void => {
    position.current = pos;
    for (const l of [...listeners.current]) l(pos);
  };
  const lines = useRef({ value: 0, at: -Infinity });
  const report = (done: number, force: boolean): void => {
    const t = now();
    if (done === lines.current.value && !force) return;
    if (!force && t - lines.current.at < LINES_EVERY_MS) return;
    lines.current = { value: done, at: t };
    setCompleted(done);
    onLinesRef.current?.(done);
  };
  const showAt = (seconds: number, force: boolean): void => {
    if (segments === null || timeline === null) return;
    const p = pointAt(segments, timeline, seconds);
    tell(p?.pos ?? null);
    if (p !== null) report(p.completed, force);
  };
  const ensure = (): Player | null => {
    if (timeline === null) return null;
    player.current ??= createPlayer(timeline.total, now);
    return player.current;
  };

  function stop(): void {
    player.current?.pause();
    player.current = null;
    setActive(false);
    setPlaying(false);
    tell(null);
  }

  // A new file (or timing) ends the session; so does losing permission (a job starting, the board moving).
  useEffect(() => stop, [timeline]);
  useEffect(() => { if (!available && player.current !== null) stop(); }, [available]);

  // The frames, only while playing.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (): void => {
      const p = player.current;
      if (p === null) return;
      const t = p.time();
      const still = p.playing;
      showAt(t, !still);
      if (!still) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); };
  }, [playing]);

  const feed = useMemo<PlayFeed>(() => ({
    subscribe(listener) {
      listeners.current.add(listener);
      listener(position.current);
      return () => { listeners.current.delete(listener); };
    },
  }), []);

  return {
    available,
    active,
    playing,
    speed,
    completed,
    reducedMotion,
    feed,
    play() {
      if (!available || reducedMotion) return;
      const p = ensure();
      if (p === null) return;
      p.setSpeed(speed);
      p.play();
      setActive(true);
      setPlaying(true);
      showAt(p.time(), true);
    },
    pause() {
      player.current?.pause();
      setPlaying(false);
      if (player.current !== null) showAt(player.current.time(), true);
    },
    setSpeed(next) {
      setSpeedState(next);
      player.current?.setSpeed(next);
    },
    seekLine(line) {
      const p = player.current;
      if (p === null || segments === null || timeline === null) return;
      p.seek(lineStartTime(segments, timeline, line));
      showAt(p.time(), true);
    },
    stop,
    step() {
      if (!available || segments === null || timeline === null) return;
      const p = ensure();
      if (p === null) return;
      setActive(true);
      // To the end of the next line that moves.
      const ltv = segments.lineToVertex;
      let line = lines.current.value;
      while (line < ltv.length - 1 && (ltv[line + 1] as number) <= (ltv[line] as number)) line++;
      const last = Math.min(ltv.length - 1, line + 1);
      p.seek(lineStartTime(segments, timeline, last));
      showAt(p.time(), true);
    },
  };
}
