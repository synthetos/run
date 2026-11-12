import { ToolCatalog } from './tools/ToolCatalog.ts';
import { h, type ComponentChild } from 'preact';
import type { WorkspaceModel } from '../model.ts';
import { librarySection, type LibrarySection } from '../jobWorkflow.ts';
import { TabBar, TabPane } from '../ui.ts';
import { MaterialsView, ToolsView } from './LibraryViews.ts';
import { MachinesView } from './MachinesView.ts';

export function LibraryView({ model, onView }: { readonly model: WorkspaceModel | null; readonly onView: (view: string) => void }): ComponentChild {
  const current = librarySection.value;
  return h('div', { class: 'library-view' },
    h('div', { class: 'view-head library-head' }, h('h1', null, 'Library'),
      h(TabBar<LibrarySection>, { prefix: 'library', label: 'Library', variant: 'underline', current, onSelect: (id) => { librarySection.value = id; }, tabs: [
        { id: 'machines', label: 'Machines' }, { id: 'tools', label: 'My tools' }, { id: 'catalog', label: 'Tool catalog' }, { id: 'materials', label: 'Materials' },
      ] })),
    h(TabPane, { prefix: 'library', id: 'machines', current }, h(MachinesView, { model, onView })),
    h(TabPane, { prefix: 'library', id: 'tools', current }, h(ToolsView, null)),
    h(TabPane, { prefix: 'library', id: 'catalog', current }, h(ToolCatalog, null)),
    h(TabPane, { prefix: 'library', id: 'materials', current }, h(MaterialsView, null)));
}
