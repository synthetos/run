import { h, type ComponentChild } from 'preact';
import type { WorkspaceModel } from '../model.ts';
import { selectedMachine } from '../library.ts';
import { executionLock } from '../fileBridge.ts';
import { updateActiveJob, withMachine } from '../jobModel.ts';
import { jobStep } from '../jobWorkflow.ts';
import { librarySection, type LibrarySection } from '../jobWorkflow.ts';
import { TabBar, TabPane } from '../ui.ts';
import { MaterialsView, ToolsView } from './LibraryViews.ts';
import { MachinesView } from './MachinesView.ts';

export function LibraryView({ model, onView }: { readonly model: WorkspaceModel | null; readonly onView: (view: string) => void }): ComponentChild {
  const current = librarySection.value;
  return h('div', { class: 'library-view' },
    h('div', { class: 'view-head' }, h('h1', null, 'Library'),
      h(TabBar<LibrarySection>, { prefix: 'library', label: 'Library', current, onSelect: (id) => { librarySection.value = id; }, tabs: [
        { id: 'machines', label: 'Machines' }, { id: 'tools', label: 'Tools' }, { id: 'materials', label: 'Materials' },
      ] })),
    h(TabPane, { prefix: 'library', id: 'machines', current },
      h('div', { class: 'library-job-action' }, h('button', { type: 'button', class: 'small primary', 'data-action': 'job-use-machine', disabled: selectedMachine.value === null || executionLock.value !== null, onClick: () => { if (executionLock.value !== null) return; updateActiveJob((j) => withMachine(j, selectedMachine.value)); jobStep.value = 'machine'; onView('job'); } }, 'Use this machine in Job')),
      h(MachinesView, { model, onView })),
    h(TabPane, { prefix: 'library', id: 'tools', current }, h(ToolsView, null)),
    h(TabPane, { prefix: 'library', id: 'materials', current }, h(MaterialsView, null)));
}
