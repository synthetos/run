/** The bench console feed: posts the transcript when it changes, once at a time, and retries after a refused post. */
import { describe, expect, it } from 'vitest';
import { CONSOLE_FEED_INTERVAL_MS, watchConsoleFeed } from '../src/channel/consoleFeed.ts';

function harness(): {
  readonly ticks: (() => void)[];
  readonly posts: string[];
  transcript: string | null;
  accept: boolean;
  readonly cleared: unknown[];
  stop: () => void;
  readonly intervals: number[];
} {
  const ticks: (() => void)[] = [];
  const posts: string[] = [];
  const cleared: unknown[] = [];
  const intervals: number[] = [];
  const h = {
    ticks,
    posts,
    cleared,
    intervals,
    transcript: null as string | null,
    accept: true,
    stop: (() => undefined) as () => void,
  };
  h.stop = watchConsoleFeed({
    read: () => Promise.resolve(h.transcript),
    post: (jsonl) => {
      posts.push(jsonl);
      return Promise.resolve(h.accept);
    },
    setInterval: (fn, ms) => {
      ticks.push(fn);
      intervals.push(ms);
      return 'handle';
    },
    clearInterval: (handle) => {
      cleared.push(handle);
    },
  });
  return h;
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('watchConsoleFeed', () => {
  it('posts nothing while there is no link, posts a transcript once, and again only after it changed', async () => {
    const h = harness();
    expect(h.intervals).toEqual([CONSOLE_FEED_INTERVAL_MS]);
    const tick = h.ticks[0] as () => void;
    tick();
    await settle();
    expect(h.posts).toEqual([]);
    h.transcript = '{"t":1,"dir":"tx","text":"{sr:null}"}';
    tick();
    await settle();
    tick();
    await settle();
    expect(h.posts).toEqual([h.transcript]);
    h.transcript += '\n{"t":2,"dir":"rx","text":"{\\"r\\":{}}"}';
    tick();
    await settle();
    expect(h.posts).toHaveLength(2);
    expect(h.posts[1]).toBe(h.transcript);
  });

  it('retries a transcript the server refused, runs one read at a time, and stops with its interval', async () => {
    const h = harness();
    const tick = h.ticks[0] as () => void;
    h.transcript = 'a';
    h.accept = false;
    tick();
    tick(); // the first read is still in flight: ignored
    await settle();
    expect(h.posts).toEqual(['a']);
    tick();
    await settle();
    expect(h.posts).toEqual(['a', 'a']);
    h.accept = true;
    tick();
    await settle();
    tick();
    await settle();
    expect(h.posts).toEqual(['a', 'a', 'a']);
    h.stop();
    expect(h.cleared).toEqual(['handle']);
  });

  it('a read that throws is ignored and the next tick reads again', async () => {
    let calls = 0;
    const posts: string[] = [];
    const ticks: (() => void)[] = [];
    watchConsoleFeed(
      {
        read: () => (++calls === 1 ? Promise.reject(new Error('worker gone')) : Promise.resolve('b')),
        post: (jsonl) => {
          posts.push(jsonl);
          return Promise.resolve(true);
        },
        setInterval: (fn) => {
          ticks.push(fn);
          return 1;
        },
        clearInterval: () => undefined,
      },
      500,
    );
    const tick = ticks[0] as () => void;
    tick();
    await settle();
    tick();
    await settle();
    expect(posts).toEqual(['b']);
  });
});
