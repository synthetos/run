import { h, type ComponentChild } from 'preact';
import { librarySyncActions, librarySyncView } from './librarySync.ts';
/** The account sync toast: quota and refusal notices with their retry. The browser-to-account copy prompt is gone (spec §5.5). */
export function LibrarySyncNotice(): ComponentChild {
  const view = librarySyncView.value;
  return h('div', { 'data-library-sync': view.mode },
    view.notice === null ? null : h('aside', { class: 'toast library-sync-notice', role: 'status', 'data-library-notice': '' }, h('p', null, view.notice),
      view.remaining.length ? h('ul', null, ...view.remaining.map(name => h('li', { key: name }, name))) : null,
      ['quota', 'refused'].includes(view.status) ? h('button', { type: 'button', onClick: () => librarySyncActions.retry() }, 'Try again') : null,
      h('button', { type: 'button', onClick: () => librarySyncActions.dismiss() }, 'Dismiss')),
  );
}
