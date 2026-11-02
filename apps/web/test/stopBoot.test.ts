/**
 * SAFETY §4.3: Escape in every tab requests a stop of every LIVE machine,
 * even when the page's shell fails to render. The workspace entry starts the
 * stop paths before hydration and runs hydration guarded.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderGuarded, startStopPaths } from '../src/live/stopBoot.ts';
import type { BroadcastChannelLike, LockManagerLike } from '../src/machine-worker/stopChannel.ts';
import type { Timers } from '../src/live/tabStop.ts';

const timers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
const locks: LockManagerLike = { request: () => Promise.resolve(), query: () => Promise.resolve({ held: [] }) };

describe('stop paths survive a failed render (SAFETY §4.3)', () => {
  it('Escape still broadcasts a pause request when the shell render throws', () => {
    const posted: unknown[] = [];
    const channel: BroadcastChannelLike = { postMessage: (m) => posted.push(m), addEventListener: () => undefined };
    let keydown: ((e: KeyboardEvent) => void) | null = null;
    const paths = startStopPaths({
      target: { addEventListener: (_t, l) => (keydown = l) },
      channel,
      locks,
      timers,
      newId: () => 'id-1',
      pauseOwnWorker: () => undefined,
    });
    const errors: unknown[] = [];
    const rendered = renderGuarded(() => {
      throw new Error('component failed');
    }, (e) => errors.push(e));
    expect(rendered).toBe(false);
    expect(errors).toHaveLength(1);
    expect(keydown).not.toBeNull();
    (keydown as unknown as (e: { key: string }) => void)({ key: 'Escape' });
    expect(posted).toContainEqual(expect.objectContaining({ kind: 'stop-request', action: 'pause' }));
    paths.watcher.stop();
  });

  it('renderGuarded returns true when the render succeeds', () => {
    expect(renderGuarded(() => undefined, () => undefined)).toBe(true);
  });

  it('the workspace entry starts the stop paths before hydrate, and hydrate runs inside renderGuarded', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/entries/workspace.ts', import.meta.url)), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const start = code.indexOf('startStopPaths(');
    const guard = code.indexOf('renderGuarded(');
    const hydrate = code.indexOf('hydrate(');
    expect(start).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(start);
    expect(hydrate).toBeGreaterThan(guard);
    expect(code).not.toMatch(/installEscapeStop\(/);
  });
});
