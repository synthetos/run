/**
 * The workspace shell (Stage 1) and the safety bar: W1 first, the top bar,
 * the machine strip with W7 NOT CONNECTED and the disabled Pause (W2) and
 * Stop job, the ten-view rail with only Run shown, W13 on the preview, and
 * the version in the footer. The browser-level checks (no document scroll,
 * view switching keeps the worker, axe) are in tools/e2e.
 */
import { describe, expect, it } from 'vitest';
import { Fragment, h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { STOP_TEXT, w1, w13, w2Label, w7 } from '@synthetos/safety';
import { AppShell, VIEWS } from '../src/workspace/AppShell.ts';
import { SafetyBar, STOP_UNAVAILABLE } from '../src/shell/SafetyBar.ts';
import { versionLabel } from '../src/build-info/buildInfo.ts';
import { all, byAttr, one, root, text } from './tree.ts';

const build = { version: '1.2.3', sha: '0123456789abcdef0123456789abcdef01234567' };

function escaped(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

describe('workspace AppShell (prerendered)', () => {
  const html = renderToString(h(Fragment, null, h(AppShell, { build })));

  it('renders W1 first, then the top bar, the machine strip, the rail and views, and the footer', () => {
    const order = ['data-region="safety-bar"', 'class="topbar"', 'data-region="machine-strip"', 'data-region="rail"', 'data-region="centre"', 'class="footer"'].map((m) => html.indexOf(m));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(escaped(w1().slice(w1().indexOf(' — ') + 3)));
  });

  it('the rail lists the ten views in order, and only Run is shown', () => {
    expect(VIEWS.map((v) => v.label)).toEqual(['Run', 'Setup', 'Tools', 'Materials', 'Board', 'Machines', 'Projects', 'Analyze', 'Settings', 'Safety']);
    for (const v of VIEWS) {
      const at = html.indexOf(`data-screen="${v.id}"`);
      expect(at, v.id).toBeGreaterThan(0);
      const tag = html.slice(html.lastIndexOf('<section', at), html.indexOf('>', at));
      expect(tag.includes('hidden'), v.id).toBe(v.id !== 'run');
    }
    expect(html).toMatch(/data-view="run" aria-current="page"/);
  });

  it('the machine strip shows W7 NOT CONNECTED, and Pause and Stop job disabled with the reason', () => {
    expect(html).toContain(escaped(w7().slice(w7().indexOf(' — ') + 3)));
    expect(html).toContain('data-safety="W7"');
    const pause = /<button[^>]*data-safety="W2"[^>]*>/.exec(html)?.[0] ?? '';
    expect(pause).toContain('disabled');
    expect(pause).toContain(`title="${STOP_UNAVAILABLE}"`);
    expect(pause).toContain('aria-describedby="stop-unavailable"');
    const stop = /<button[^>]*data-action="stop-job"[^>]*>/.exec(html)?.[0] ?? '';
    expect(stop).toContain('disabled');
    expect(html).toContain(`<span>${w2Label()}</span>`);
    expect(html).toContain(`<span>${STOP_TEXT.stopJob}</span>`);
    expect(html).toContain(`id="stop-unavailable" class="sr-only">${STOP_UNAVAILABLE}<`);
  });

  it('W13 is on the preview, and the version is in the footer', () => {
    expect(html).toContain(escaped(w13()));
    expect(html).toMatch(new RegExp(`data-version(="")? title="Version ${build.version}, commit ${build.sha}">${escaped(versionLabel(build))}<`));
  });

  it('prerendered, the preview controls are disabled and Start job is disabled with its reason', () => {
    expect(/<input[^>]*data-preview="file"[^>]*>/.exec(html)?.[0]).toContain('disabled');
    expect(/<select[^>]*data-preview="mode"[^>]*>/.exec(html)?.[0]).toContain('disabled');
    expect(/<button[^>]*data-action="start-job"[^>]*>/.exec(html)?.[0]).toContain('disabled');
    expect(html).toContain('Running jobs arrives in a later phase.');
    expect(html).toContain('Jogging arrives with motion control.');
    expect(html).toContain('Needs firmware support');
  });

  it('carries no inline style attribute (CSP style-src self) and no link to another origin', () => {
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/:\/\//);
  });

  it('has no Play, Simulate or Animate control in the preview (SAFETY H15, T-S41)', () => {
    const start = html.indexOf('data-region="preview"');
    const region = html.slice(start, html.indexOf('data-screen="setup"'));
    expect(region.replace(/<[^>]*>/g, ' ')).not.toMatch(/\b(play|simulat|animat)/i);
  });
});

describe('SafetyBar', () => {
  it('page variant: W1 and the version chip, and no machine controls', () => {
    const bar = root(h(SafetyBar, { build, variant: 'page' }));
    expect(text(one(bar, byAttr('data-safety', 'W1')))).toBe(w1());
    expect(text(one(bar, byAttr('data-version')))).toBe(versionLabel(build));
    expect(all(bar, byAttr('data-safety', 'W7'))).toEqual([]);
    expect(all(bar, (e) => e.tag === 'button')).toEqual([]);
  });

  it('workspace variant: W1 only, as a labelled region', () => {
    const bar = root(h(SafetyBar, { build, variant: 'workspace' }));
    expect(bar.props['role']).toBe('region');
    expect(bar.props['aria-label']).toBe('Safety');
    expect(text(one(bar, byAttr('data-safety', 'W1')))).toBe(w1());
    expect(all(bar, byAttr('data-version'))).toEqual([]);
    expect(all(bar, (e) => e.tag === 'button')).toEqual([]);
  });
});
