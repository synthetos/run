import { expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import { ChoiceModal } from '../src/workspace/run/ChoiceModal.ts';
import { DialogWrap } from '../src/workspace/dialogs/DialogWrap.ts';

it('blockers and OK-only choices have no shared Escape/backdrop handler, even if given a callback', () => {
  const onDismiss = vi.fn();
  for (const label of ['OK', 'Review settings', 'Home all']) {
    const modal = ChoiceModal({ title: 'Blocked', body: 'Needs you', onDismiss, choices: [{ id: 'choice', label, onClick: vi.fn() }] }) as VNode;
    expect(modal.type).toBe('div'); expect(modal.props).not.toHaveProperty('onDismiss');
  }
  expect(onDismiss).not.toHaveBeenCalled();
});
it('only explicit Cancel/Not now callbacks opt into shared dismissal', () => {
  const onDismiss = vi.fn();
  for (const label of ['Cancel', 'Not now']) {
    const props = { title: 'Confirm', body: 'Continue?', choices: [{ id: 'cancel', label, onClick: onDismiss }] };
    expect((ChoiceModal(props) as VNode).type).toBe('div');
    const modal = ChoiceModal({ ...props, onDismiss }) as VNode<{ onDismiss: () => void }>;
    expect(modal.type).toBe(DialogWrap); modal.props.onDismiss();
  }
  expect(onDismiss).toHaveBeenCalledTimes(2);
});
