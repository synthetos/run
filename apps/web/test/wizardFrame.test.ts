import { describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { all, byAttr, one, root, text } from './tree.ts';
import { WizardFrame } from '../src/wizard/WizardFrame.ts';
import { WizardRail } from '../src/wizard/WizardRail.ts';
import type { RailMark } from '../src/wizard/wizardState.ts';

const marks: RailMark[] = ['done', 'current', 'later', 'later', 'later', 'later', 'later'];

describe('WizardFrame', () => {
  it('is the scrim and one dialog labelled by the heading, with the rail, the lead, the body and the footer', () => {
    const el = root(h('div', null, h(WizardFrame, { step: 2, marks, title: 'Your machine', lead: 'Tell Run what is on the bench.', primary: { label: 'Next: firmware', onClick: () => undefined, disabled: true }, onSkip: () => undefined, onClose: () => undefined }, h('p', { class: 'body-mark' }, 'fields'))));
    expect(all(el, (e) => e.props['class'] === 'gate-scrim')).toHaveLength(1);
    const dialog = one(el, byAttr('role', 'dialog'));
    expect(dialog.props['aria-modal']).toBe('true');
    expect(dialog.props['aria-labelledby']).toBe('wizard-title');
    expect(dialog.props['data-wizard-step']).toBe('2');
    const title = one(dialog, byAttr('id', 'wizard-title'));
    expect(title.tag).toBe('h2');
    expect(text(title)).toBe('Your machine');
    expect(title.props['tabindex']).toBe(-1);
    expect(text(one(dialog, (e) => e.props['class'] === 'wizard-lead'))).toBe('Tell Run what is on the bench.');
    expect(all(dialog, (e) => e.props['class'] === 'body-mark')).toHaveLength(1);
    expect(all(dialog, byAttr('data-mark'))).toHaveLength(7);
    const next = one(dialog, byAttr('data-action', 'wizard-next'));
    expect(text(next)).toBe('Next: firmware');
    expect(next.props['disabled']).toBe(true);
    expect(all(dialog, byAttr('data-action', 'wizard-skip'))).toHaveLength(1);
    // An X icon, named for screen readers and on hover (owner 2026-11-19, picture 163: not "weird text").
    const close = one(dialog, byAttr('data-action', 'wizard-close'));
    expect(close.props['aria-label']).toBe('Close setup');
    expect(close.props['title']).toBe('Close setup');
    expect(text(close)).toBe('');
    expect(all(close, (e) => e.tag === 'svg')).toHaveLength(1);
    expect(text(dialog)).not.toMatch(/E-stop|never need|Saved in this browser/);
  });
  it('a step that cannot be skipped has no skip button; the primary calls back', () => {
    const onClick = vi.fn();
    const dialog = one(root(h('div', null, h(WizardFrame, { step: 1, marks, title: 'Welcome to Run', lead: '', primary: { label: 'Set up my machine', onClick }, onSkip: null, onClose: () => undefined }))), byAttr('role', 'dialog'));
    expect(all(dialog, byAttr('data-action', 'wizard-skip'))).toHaveLength(0);
    (one(dialog, byAttr('data-action', 'wizard-next')).props['onClick'] as () => void)();
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('an overlay (the catalog page, the tool editor) renders inside the wizard dialog, after the frame, not in its body', () => {
    const dialog = one(root(h('div', null, h(WizardFrame, { step: 5, marks, title: 'Tools', lead: '', primary: { label: 'Next: project', onClick: () => undefined }, onSkip: null, onClose: () => undefined, overlay: h('div', { class: 'overlay-mark' }) }))), byAttr('role', 'dialog'));
    const kids = dialog.children.filter((c) => typeof c !== 'string') as { props: Record<string, unknown> }[];
    expect(kids.map((k) => k.props['class'])).toEqual(['wizard-dialog', 'overlay-mark']);
  });
  it('review minor 11: the frame is inert while the catalog page covers it, and only then', () => {
    const frame = (inertFrame: boolean) => one(root(h('div', null, h(WizardFrame, { step: 5, marks, title: 'Tools', lead: '', primary: { label: 'Next: project', onClick: () => undefined }, onSkip: null, onClose: () => undefined, overlay: h('div', { class: 'overlay-mark' }), inertFrame }))), (e) => e.props['class'] === 'wizard-dialog');
    expect(frame(true).props['inert']).toBe(true);
    expect(frame(false).props['inert']).toBeUndefined();
  });
});

describe('WizardRail', () => {
  it('shows the wordmark at 26 px, seven numbered steps with their marks, and the current step name for the dots strip', () => {
    const el = root(h('div', null, h(WizardRail, { marks, current: 2 })));
    const mark = one(el, byAttr('role', 'img'));
    expect(mark.props['aria-label']).toBe('run');
    expect(mark.props['height']).toBe(26);
    const items = all(el, byAttr('data-mark'));
    expect(items.map((i) => i.props['data-mark'])).toEqual(marks);
    expect(items.map((i) => i.props['aria-current'])).toEqual([undefined, 'step', undefined, undefined, undefined, undefined, undefined]);
    expect(text(items[2] as never)).toContain('3');
    expect(text(items[2] as never)).toContain('Firmware');
    // A done step shows a check, not its number.
    expect(all(items[0] as never, (e) => e.tag === 'svg')).toHaveLength(1);
    expect(text(one(el, (e) => e.props['class'] === 'wizard-dot-name'))).toBe('Machine');
  });
});
