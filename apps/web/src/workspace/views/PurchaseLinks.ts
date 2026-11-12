import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { safeExternalLink, hostOf, money, type PurchaseLink } from '../library.ts';
import { Icon } from '../icons.ts';
/** A purchase line: a plain external link when `safeExternalLink` accepts it, plain text otherwise. */
export function PurchaseLine({ p, onRemove }: { readonly p: PurchaseLink; readonly onRemove?: () => void }): ComponentChild {
  const link = safeExternalLink(p.url);
  const name = p.vendor !== '' ? p.vendor : link === null ? p.url : hostOf(link.href);
  const meta = [p.sku, p.price === undefined ? null : money(p.price, p.currency), p.boughtAt === undefined ? null : `bought ${p.boughtAt}`].filter((x) => x !== null && x !== undefined && x !== '').join(' · ');
  return h(
    'li',
    { class: 'purchase' },
    link === null ? h('span', null, name) : h('a', { href: link.href, target: link.target, rel: link.rel, 'data-external': hostOf(link.href), title: link.href }, name, Icon('external', 12), h('span', { class: 'sr-only' }, ' (opens in a new tab)')),
    meta === '' ? null : h('small', null, meta),
    onRemove === undefined ? null : h('button', { type: 'button', class: 'icon-button quiet remove', 'data-action': 'remove-link', 'aria-label': `Remove the link to ${name}`, onClick: onRemove }, Icon('trash', 14)),
  );
}

/** One web address and Add. Shop name and price sit behind "More". */
export function AddLink({ onAdd }: { readonly onAdd: (p: PurchaseLink) => string | null }): ComponentChild {
  const [url, setUrl] = useState('');
  const [more, setMore] = useState(false);
  const [vendor, setVendor] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  return h(
    'form',
    {
      class: 'add-link',
      onSubmit: (e: Event) => {
        e.preventDefault();
        const link = safeExternalLink(url.trim());
        if (link === null) {
          setError('Enter a full web address that starts with https');
          return;
        }
        const n = Number.parseFloat(price);
        const refused = onAdd({ kind: 'link', vendor: vendor.trim().slice(0, 60) || hostOf(link.href), url: link.href, ...(Number.isFinite(n) && n >= 0 ? { price: Math.round(n * 100) / 100, currency: 'USD' } : {}) });
        if (refused !== null) {
          setError(refused);
          return;
        }
        setUrl('');
        setVendor('');
        setPrice('');
        setError(null);
      },
    },
    h(
      'div',
      { class: 'add-link-row' },
      h('input', { type: 'url', value: url, maxLength: 500, placeholder: 'Paste a web address', 'aria-label': 'Link', onInput: (e: Event) => setUrl((e.currentTarget as HTMLInputElement).value) }),
      h('button', { type: 'submit', class: 'small', 'data-action': 'add-link' }, Icon('plus', 14), 'Add'),
      h('button', { type: 'button', class: 'small quiet', 'data-action': 'more-link', 'aria-expanded': more ? 'true' : 'false', onClick: () => setMore(!more) }, 'More'),
    ),
    more
      ? h(
          'div',
          { class: 'add-link-more' },
          h('input', { value: vendor, maxLength: 60, placeholder: 'Shop (optional)', 'aria-label': 'Shop', onInput: (e: Event) => setVendor((e.currentTarget as HTMLInputElement).value) }),
          h('input', { type: 'number', min: 0, step: 0.01, value: price, placeholder: 'Price, USD', 'aria-label': 'Price in US dollars', onInput: (e: Event) => setPrice((e.currentTarget as HTMLInputElement).value) }),
        )
      : null,
    error === null ? null : h('p', { class: 'field-error', role: 'alert' }, error),
  );
}

