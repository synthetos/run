/**
 * Paging instead of scrolling (owner walk 2026-11-19: "we dont like scroll bars"): how many fixed-height lines fit
 * a box, one page of a list, and the Back / Next line under it. The box has a height that does not depend on its
 * content (a flex child with min-height 0 that clips), so measuring it is stable; it is measured again whenever it
 * resizes. Before the first measure (and in a render with no layout) everything shows on one page.
 */
import { h, type ComponentChild } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';

export function usePageSize(box: { readonly current: HTMLElement | null }, linePx: number): number {
  const [size, setSize] = useState(Number.POSITIVE_INFINITY);
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => setSize(Math.max(1, Math.floor(el.clientHeight / linePx)));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [box, linePx]);
  return size;
}

/** Page `page` of `items` at `size` a page, the page kept in range. */
export function pageOf<T>(items: readonly T[], page: number, size: number): { readonly items: readonly T[]; readonly page: number; readonly pages: number } {
  const pages = Number.isFinite(size) && size > 0 ? Math.max(1, Math.ceil(items.length / size)) : 1;
  const at = Math.min(Math.max(0, page), pages - 1);
  return { items: pages === 1 ? items : items.slice(at * size, (at + 1) * size), page: at, pages };
}

/**
 * Back, "Page n of m", Next. Always laid out (hidden by class when there is one page), so showing it never changes
 * the space the list gets. `name` prefixes the actions (`<name>-page-back`, `<name>-page-next`).
 */
export function Pager({ name, page, pages, onPage }: { readonly name: string; readonly page: number; readonly pages: number; readonly onPage: (p: number) => void }): ComponentChild {
  return h(
    'div',
    { class: `pager${pages === 1 ? ' single' : ''}`, 'data-pages': String(pages) },
    h('button', { type: 'button', class: 'small', 'data-action': `${name}-page-back`, disabled: page === 0, onClick: () => onPage(page - 1) }, 'Back'),
    h('span', { class: 'fine' }, `Page ${page + 1} of ${pages}`),
    h('button', { type: 'button', class: 'small', 'data-action': `${name}-page-next`, disabled: page >= pages - 1, onClick: () => onPage(page + 1) }, 'Next'),
  );
}
