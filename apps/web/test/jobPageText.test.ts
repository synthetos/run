/**
 * The job page text sweep (docs/superpowers/specs/2026-11-16-first-run-design.md §7): the reassurance lines are
 * gone and step 4 hints what Check does. The warning bar and /safety say the stop rules once.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { AccountNotice } from '../src/live/accountNotice.ts';
import { stepStatus } from '../src/workspace/views/run/steps.ts';
import { root, text } from './tree.ts';

describe('job page text sweep (spec §7)', () => {
  it('the account notice has no "never need an account" line', () => {
    expect(text(root(h(AccountNotice, {})))).not.toContain('never need an account');
  });

  it('step 4 hints what Check does when no file is open', () => {
    const parts = { state: { status: 'idle', ready: true, fileName: null } } as never;
    expect(stepStatus('check', parts, null)).toBe('Review the safety verdict');
  });
});
