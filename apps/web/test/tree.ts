/**
 * Test helpers: expand a Preact tree (calling function components) into
 * plain elements, then query it like a tiny DOM. No browser needed.
 */
import type { ComponentChild, ComponentChildren } from 'preact';

export interface El {
  readonly tag: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: readonly (El | string)[];
}

function flatten(children: ComponentChildren): ComponentChild[] {
  if (Array.isArray(children)) return children.flatMap((c) => flatten(c as ComponentChildren));
  return [children as ComponentChild];
}

/** Expands components and drops null/boolean children. */
export function expand(node: ComponentChild): (El | string)[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') return [String(node)];
  const vnode = node as { type: unknown; props: Record<string, unknown> };
  if (typeof vnode.type === 'function') {
    const rendered = (vnode.type as (p: unknown) => ComponentChild)(vnode.props);
    return expand(rendered);
  }
  if (vnode.type === undefined || vnode.type === null || typeof vnode.type === 'symbol' || (typeof vnode.type === 'object')) {
    // Fragment
    return flatten(vnode.props['children'] as ComponentChildren).flatMap(expand);
  }
  const { children, ...props } = vnode.props;
  return [{ tag: vnode.type as string, props, children: flatten(children as ComponentChildren).flatMap(expand) }];
}

export function root(node: ComponentChild): El {
  const [first, ...rest] = expand(node);
  if (first === undefined || typeof first === 'string' || rest.length > 0) throw new Error('expected one root element');
  return first;
}

export function all(el: El, pred: (e: El) => boolean): El[] {
  const out: El[] = pred(el) ? [el] : [];
  for (const c of el.children) if (typeof c !== 'string') out.push(...all(c, pred));
  return out;
}

export function one(el: El, pred: (e: El) => boolean, what = 'element'): El {
  const found = all(el, pred);
  if (found.length !== 1) throw new Error(`expected exactly one ${what}, found ${found.length}`);
  return found[0] as El;
}

export const byAttr = (name: string, value?: string) => (e: El): boolean =>
  value === undefined ? e.props[name] !== undefined : e.props[name] === value;

export function text(el: El | string): string {
  return typeof el === 'string' ? el : el.children.map(text).join('');
}
