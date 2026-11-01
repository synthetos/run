/** The theme toggle (RUN_PLAN §7.1), against a fake DOM and storage. */
import { describe, expect, it } from 'vitest';
import { applyStoredTheme, currentTheme, storedTheme, THEME_KEY, toggleTheme, wireThemeToggle, type StorageLike, type ThemeHost } from '../src/theme/theme.ts';

function fakeHost(initial: string | null = null): ThemeHost & { attr: string | null; clicks: (() => void)[] } {
  const host = {
    attr: initial,
    clicks: [] as (() => void)[],
    documentElement: {
      getAttribute: (name: string) => (name === 'data-theme' ? host.attr : null),
      setAttribute: (name: string, value: string) => {
        if (name === 'data-theme') host.attr = value;
      },
    },
    querySelectorAll: (selector: string) => (selector === '[data-theme-toggle]' ? [{ addEventListener: (_t: 'click', fn: () => void) => host.clicks.push(fn) }] : []),
  };
  return host;
}

function memory(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

const broken = (): StorageLike => {
  throw new Error('SecurityError: storage is blocked');
};

describe('theme', () => {
  it('follows the OS when nothing is stored or set', () => {
    expect(currentTheme(fakeHost(), () => true)).toBe('dark');
    expect(currentTheme(fakeHost(), () => false)).toBe('light');
  });

  it('an explicit data-theme wins over the OS', () => {
    expect(currentTheme(fakeHost('light'), () => true)).toBe('light');
  });

  it('applies a stored choice, and ignores an invalid one', () => {
    const host = fakeHost();
    applyStoredTheme(host, () => memory({ [THEME_KEY]: 'dark' }));
    expect(host.attr).toBe('dark');
    const other = fakeHost();
    applyStoredTheme(other, () => memory({ [THEME_KEY]: 'neon' }));
    expect(other.attr).toBeNull();
  });

  it('toggles from the OS theme and stores the choice', () => {
    const host = fakeHost();
    const store = memory();
    expect(toggleTheme(host, () => store, () => true)).toBe('light');
    expect(host.attr).toBe('light');
    expect(store.data[THEME_KEY]).toBe('light');
    expect(toggleTheme(host, () => store, () => true)).toBe('dark');
  });

  it('still works when storage is unavailable', () => {
    expect(storedTheme(broken)).toBeNull();
    const host = fakeHost();
    applyStoredTheme(host, broken);
    expect(host.attr).toBeNull();
    expect(toggleTheme(host, broken, () => false)).toBe('dark');
    expect(host.attr).toBe('dark');
  });

  it('wires every toggle button', () => {
    const host = fakeHost();
    wireThemeToggle(host, () => memory(), () => false);
    expect(host.clicks).toHaveLength(1);
    host.clicks[0]!();
    expect(host.attr).toBe('dark');
  });
});
