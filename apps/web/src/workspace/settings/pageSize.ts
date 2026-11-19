/**
 * How many fixed-height lines fit a box (owner walk 2026-11-19: no scrolling). The box has a height that does not
 * depend on its content (a flex child with min-height 0 that clips), so measuring it is stable; it is measured again
 * whenever it resizes. Before the first measure (and in a render with no layout) every line shows.
 */
import { useLayoutEffect, useState } from 'preact/hooks';

export function usePageSize(box: { readonly current: HTMLElement | null }, linePx: number): number {
  const [size, setSize] = useState(Number.POSITIVE_INFINITY);
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => setSize(Math.max(3, Math.floor(el.clientHeight / linePx)));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [box, linePx]);
  return size;
}
