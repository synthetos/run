import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { projectDownload } from '../workspace/cloud/projectSyncState.ts';
import type { Project } from './store.ts';

export function AccountProject({ project }: { readonly project: Project }): ComponentChild {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const open = () => {
    setBusy(true); setError(false);
    void projectDownload.open(project.id).catch(() => setError(true)).finally(() => setBusy(false));
  };
  return h('section', { class: 'panel empty-panel', 'data-project': 'account-only' },
    h('h2', null, project.name), h('p', null, 'In your account, not downloaded'),
    h('button', { type: 'button', class: 'primary', disabled: busy, onClick: open }, busy ? 'Downloading…' : 'Open project'),
    error ? h('p', { role: 'status' }, 'The download did not finish. Your account copy is safe; try again when sync is available.') : null);
}
