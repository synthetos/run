import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import { Shell } from '../src/shell/Shell.tsx';

type Props = { class?: string; children?: VNode<Props> | VNode<Props>[]; [k: string]: unknown };

describe('workspace Shell', () => {
  it('renders the workspace root with the three layout regions in order', () => {
    const tree = Shell() as VNode<Props>;
    expect(tree.type).toBe('div');
    expect(tree.props['data-shell']).toBe('workspace');
    const children = tree.props.children as VNode<Props>[];
    expect(children.map((c) => c.props['data-region'])).toEqual(['safety-bar', 'rail', 'centre']);
    expect(children.map((c) => c.type)).toEqual(['header', 'nav', 'main']);
  });
});
