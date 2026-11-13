import { DialogWrap } from '../dialogs/DialogWrap.ts';
import { h, type ComponentChild } from 'preact';
import { librarySyncActions, librarySyncView } from './librarySync.ts';
export function LibrarySyncNotice(): ComponentChild {
  const view = librarySyncView.value;
  return h('div', { 'data-library-sync': view.mode },
    view.ask ? h(DialogWrap, { class: 'dialog-wrap confirm-modal', onDismiss: () => librarySyncActions.notNow() }, h('section', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'library-import-title', 'data-dialog': 'library-import' },
      h('h2', { id: 'library-import-title' }, 'Copy your library?'),
      h('p', null, `You are signed in as ${view.display}. Copy this browser’s tools and materials to your account?`),
      h('p', null, 'The copies in this browser stay here.'),
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', onClick: () => librarySyncActions.notNow() }, 'Not now'), h('button', { type: 'button', class: 'primary', onClick: () => void librarySyncActions.copy() }, 'Copy')))) : null,
    view.notice === null ? null : h('aside', { class: 'toast library-sync-notice', role: 'status', 'data-library-notice': '' }, h('p', null, view.notice),
      view.remaining.length ? h('ul', null, ...view.remaining.map(name => h('li', { key: name }, name))) : null,
      view.status === 'quota' ? h('button', { type: 'button', onClick: () => librarySyncActions.retry() }, 'Try again') : null,
      h('button', { type: 'button', onClick: () => librarySyncActions.dismiss() }, 'Dismiss')),
  );
}
