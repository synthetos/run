/** The dock's height (owner, 2026-11-09: "the terminal needs room"): bounds, the Terminal's opening share, storage. */
import { describe, expect, it } from 'vitest';
import { DOCK_HEIGHT_KEY, DOCK_MIN_PX, clampDock, dockMax, loadDockHeight, saveDockHeight, terminalHeight } from '../src/workspace/dock/dockSize.ts';
import type { StorageLike } from '../src/workspace/storage.ts';

function memory(): StorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('dock height', () => {
  it('stays between a few rows and 65% of the Job view', () => {
    expect(dockMax(800)).toBe(520);
    expect(dockMax(100)).toBe(DOCK_MIN_PX);
    expect(clampDock(10, 800)).toBe(DOCK_MIN_PX);
    expect(clampDock(5000, 800)).toBe(520);
    expect(clampDock(300.4, 800)).toBe(300);
  });

  it('the Terminal opens at about 40% of the Job view', () => {
    expect(terminalHeight(800)).toBe(320);
    expect(terminalHeight(600)).toBe(240);
    expect(terminalHeight(150)).toBe(DOCK_MIN_PX);
  });

  it('is remembered in this browser; junk, a missing or a throwing storage gives none', () => {
    const s = memory();
    expect(loadDockHeight(s)).toBeNull();
    expect(saveDockHeight(321.6, s)).toBe(true);
    expect(s.data.get(DOCK_HEIGHT_KEY)).toBe('322');
    expect(loadDockHeight(s)).toBe(322);
    s.setItem(DOCK_HEIGHT_KEY, 'tall');
    expect(loadDockHeight(s)).toBeNull();
    s.setItem(DOCK_HEIGHT_KEY, '20');
    expect(loadDockHeight(s)).toBeNull();
    expect(loadDockHeight(null)).toBeNull();
    expect(saveDockHeight(200, null)).toBe(false);
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadDockHeight(throwing)).toBeNull();
    expect(saveDockHeight(200, throwing)).toBe(false);
    expect(() => loadDockHeight()).not.toThrow();
  });
});
