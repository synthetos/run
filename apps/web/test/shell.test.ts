/**
 * The workspace shell and the safety bar (ROADMAP P0-05): W1, W7 NOT
 * CONNECTED, the version and SHA, and the disabled stop button labelled W2
 * with the tooltip "Available when a machine is connected". The browser-level
 * checks (visible at 320 px and desktop, sticky, axe) are in tools/e2e.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { w1, w2Label, w7 } from '@synthetos/safety';
import { Shell } from '../src/shell/Shell.ts';
import { SafetyBar, STOP_UNAVAILABLE } from '../src/shell/SafetyBar.ts';
import { versionLabel } from '../src/build-info/buildInfo.ts';
import { all, byAttr, one, root, text } from './tree.ts';

const build = { version: '1.2.3', sha: '0123456789abcdef0123456789abcdef01234567' };

describe('workspace Shell', () => {
  const shell = root(h(Shell, { build }));

  it('renders the safety bar first, then the header, the rail and centre, and the footer', () => {
    expect(shell.props['data-shell']).toBe('workspace');
    const top = shell.children.filter((c) => typeof c !== 'string');
    expect(top.map((c) => (typeof c === 'string' ? c : `${c.tag}.${String(c.props['class'])}`))).toEqual([
      'div.safety-bar',
      'header.site-header',
      'div.workspace',
      'footer.site-footer',
    ]);
    const workspace = one(shell, (e) => e.props['class'] === 'workspace');
    expect(workspace.children.map((c) => (typeof c === 'string' ? c : c.props['data-region']))).toEqual(['rail', 'centre']);
  });

  it('the rail is empty and the centre holds only the placeholder', () => {
    const rail = one(shell, byAttr('data-region', 'rail'));
    expect(rail.tag).toBe('nav');
    expect(rail.children).toEqual([]);
    expect(text(one(shell, byAttr('data-region', 'centre')))).toContain('No machine connected');
  });

  it('the safety bar shows W1 exactly, as a labelled region', () => {
    const bar = one(shell, byAttr('data-region', 'safety-bar'));
    expect(bar.props['role']).toBe('region');
    expect(bar.props['aria-label']).toBe('Safety');
    expect(text(one(bar, byAttr('data-safety', 'W1')))).toBe(w1());
  });

  it('the state band shows W7 NOT CONNECTED exactly, as a status', () => {
    const band = one(shell, byAttr('data-safety', 'W7'));
    expect(text(band)).toBe(w7());
    expect(band.props['role']).toBe('status');
    expect(band.props['data-state']).toBe('not-connected');
  });

  it('the version chip shows the version and SHA, with the full SHA in its title', () => {
    const chip = one(shell, byAttr('data-version'), 'version chip');
    expect(text(chip)).toBe(versionLabel(build));
    expect(text(chip)).toBe('v1.2.3 · 0123456789ab');
    expect(chip.props['title']).toContain(build.sha);
  });

  it('the stop button is disabled, labelled W2, and explains why', () => {
    const buttons = all(shell, (e) => e.tag === 'button' && e.props['class'] === 'stop-button');
    expect(buttons).toHaveLength(1);
    const stop = buttons[0]!;
    expect(stop.props['disabled']).toBe(true);
    expect(stop.props['type']).toBe('button');
    expect(text(stop)).toBe(w2Label());
    expect(stop.props['title']).toBe(STOP_UNAVAILABLE);
    expect(STOP_UNAVAILABLE).toBe('Available when a machine is connected');
    const described = one(shell, byAttr('id', stop.props['aria-describedby'] as string));
    expect(text(described)).toBe(STOP_UNAVAILABLE);
    // The wrapper carries the tooltip too: Chrome shows no tooltip for a disabled button.
    expect(one(shell, (e) => e.props['class'] === 'stop-wrap').props['title']).toBe(STOP_UNAVAILABLE);
  });

  it('no control in the shell can act: the only buttons are the disabled stop button and the theme toggle', () => {
    const buttons = all(shell, (e) => e.tag === 'button');
    expect(buttons.map((b) => b.props['class'])).toEqual(['stop-button', 'theme-toggle']);
    for (const el of all(shell, () => true)) {
      expect(Object.keys(el.props).filter((k) => /^on[A-Z]/.test(k)), el.tag).toEqual([]);
    }
  });
});

describe('SafetyBar, page variant', () => {
  const bar = root(h(SafetyBar, { build, variant: 'page' }));

  it('shows W1 and the version chip, and no machine controls', () => {
    expect(text(one(bar, byAttr('data-safety', 'W1')))).toBe(w1());
    expect(text(one(bar, byAttr('data-version')))).toBe(versionLabel(build));
    expect(all(bar, byAttr('data-safety', 'W7'))).toEqual([]);
    expect(all(bar, (e) => e.tag === 'button')).toEqual([]);
  });
});
