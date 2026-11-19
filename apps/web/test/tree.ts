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
  if (Array.isArray(node)) return (node as ComponentChild[]).flatMap(expand);
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

/**
 * Like `root`, but a component in `stop` is not called: it becomes an element
 * whose tag is the component's name and whose props are its props (for
 * components that use hooks, such as dialogs).
 */
export function rootUntil(node: ComponentChild, stop: readonly unknown[]): El {
  const walk = (n: ComponentChild): (El | string)[] => {
    if (Array.isArray(n)) return (n as ComponentChild[]).flatMap(walk);
    const vnode = n as { type: unknown; props: Record<string, unknown> } | null;
    if (vnode !== null && typeof vnode === 'object' && stop.includes(vnode.type)) return [{ tag: (vnode.type as { name: string }).name, props: vnode.props, children: [] }];
    if (vnode !== null && typeof vnode === 'object' && typeof vnode.type === 'function') return walk((vnode.type as (p: unknown) => ComponentChild)(vnode.props));
    if (vnode !== null && typeof vnode === 'object' && typeof vnode.type === 'string') {
      const { children, ...props } = vnode.props;
      return [{ tag: vnode.type, props, children: flatten(children as ComponentChildren).flatMap(walk) }];
    }
    if (vnode !== null && typeof vnode === 'object' && vnode.type !== undefined) return flatten(vnode.props['children'] as ComponentChildren).flatMap(walk);
    return expand(n);
  };
  const [first] = walk(node);
  if (first === undefined || typeof first === 'string') throw new Error('expected one root element');
  return first;
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
