/** The bench tab's "newer build on the server" check (build-info/freshness.ts). */
import { describe, expect, it } from 'vitest';
import { versionLabel } from '../src/build-info/buildInfo.ts';
import { STALE_SUFFIX, labelInHtml, watchBuildFreshness } from '../src/build-info/freshness.ts';

const current = { version: '0.0.0', sha: 'a'.repeat(40), committedAt: '2026-11-03T10:48:12-05:00' };
const newer = { version: '0.0.0', sha: 'b'.repeat(40), committedAt: '2026-11-03T11:30:00-05:00' };
const page = (label: string): string => `<html><body><span data-version title="Version 0.0.0">${label}</span></body></html>`;

/** The few Element members the watcher touches, so the test needs no DOM. */
function chipEl(label: string): Element {
  const attrs = new Map<string, string>([['data-version', '']]);
  const el = {
    textContent: label as string | null,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    hasAttribute: (k: string) => attrs.has(k),
  };
  return el as unknown as Element;
}

function deps(htmls: (string | null)[]) {
  const timers: { fn: () => void; ms: number }[] = [];
  let cleared = 0;
  return {
    timers,
    cleared: () => cleared,
    deps: {
      fetchHtml: () => Promise.resolve(htmls.length > 0 ? (htmls.shift() ?? null) : null),
      setInterval: (fn: () => void, ms: number) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearInterval: () => {
        cleared += 1;
      },
    },
  };
}

describe('build freshness', () => {
  it('reads the version label out of prerendered HTML', () => {
    expect(labelInHtml(page('v0.0.0 · aaaaaaaaaaaa · 2026-11-03 10:48'))).toBe('v0.0.0 · aaaaaaaaaaaa · 2026-11-03 10:48');
    expect(labelInHtml('<html></html>')).toBeNull();
  });

  it('leaves the chip alone while the server serves the same build', async () => {
    const chip = chipEl(versionLabel(current));
    const d = deps([page(versionLabel(current))]);
    const watch = watchBuildFreshness(chip, current, d.deps, 1000);
    expect(d.timers[0]?.ms).toBe(1000);
    expect(await watch.check()).toBe(false);
    expect(chip.textContent).toBe(versionLabel(current));
    expect(chip.hasAttribute('data-stale')).toBe(false);
  });

  it('marks the chip once a newer build is served, and stops polling', async () => {
    const chip = chipEl(versionLabel(current));
    const d = deps([page(versionLabel(newer)), page(versionLabel(newer))]);
    const watch = watchBuildFreshness(chip, current, d.deps, 1000);
    expect(await watch.check()).toBe(true);
    expect(chip.getAttribute('data-stale')).toBe(versionLabel(newer));
    expect(chip.textContent).toBe(`${versionLabel(current)}${STALE_SUFFIX}`);
    expect(d.cleared()).toBe(1);
    // A second check changes nothing more (the suffix is appended once).
    expect(await watch.check()).toBe(true);
    expect(chip.textContent).toBe(`${versionLabel(current)}${STALE_SUFFIX}`);
  });

  it('treats a failed or empty fetch as "no news"', async () => {
    const chip = chipEl(versionLabel(current));
    const d = deps([null, '<html></html>']);
    const watch = watchBuildFreshness(chip, current, d.deps, 1000);
    expect(await watch.check()).toBe(false);
    expect(await watch.check()).toBe(false);
    expect(chip.hasAttribute('data-stale')).toBe(false);
    watch.stop();
    expect(d.cleared()).toBe(1);
  });

  it('works with no chip in the page', async () => {
    const d = deps([page(versionLabel(newer))]);
    const watch = watchBuildFreshness(null, current, d.deps, 1000);
    expect(await watch.check()).toBe(true);
  });
});
