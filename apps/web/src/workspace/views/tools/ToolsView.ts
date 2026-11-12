import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { toolStore, toolsByNumber, TOOL_KINDS } from '../../library.ts';
import { toolFocus } from '../../toolNumbers.ts';
import { toolDisplayName } from '../../tools/displayName.ts';
import { formatLength } from '../../tools/units.ts';
import { toolUnits } from '../../tools/preferences.ts';
import { ToolDrawing } from '../../toolDrawing/ToolDrawing.ts';
import { ToolModal } from './ToolModal.ts';
export function ToolsView(): ComponentChild {
  const tools = toolStore.value.value;
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const focus = toolFocus.value;
  useEffect(() => { if (focus !== null) { setFilter('all'); setSelected(focus); toolFocus.value = null; } }, [focus]);
  const current = tools.find(t => t.tool.id === selected) ?? null;
  const unit = toolUnits.value.value;
  return h('div', { class: 'tools-view' },
    h('div', { class: 'view-head' }, h('div', { class: 'title-block' }, h('h1', null, 'Tool library')), h('div', { class: 'view-actions' }, h('button', { type: 'button', class: 'primary', 'data-action': 'add-tool', onClick: () => setAdding(true) }, 'Add a tool'))),
    h('div', { class: 'list-panel' }, h('div', { class: 'filter-row', role: 'group', 'aria-label': 'Filter tools' }, ...[['all', 'All'], ['flat', 'End mills'], ['ball', 'Ball nose'], ['v-bit', 'V-bits'], ['drill', 'Drills'], ['o-flute', 'O-flutes']].map(([id, label]) => h('button', { type: 'button', class: `chip${filter === id ? ' selected' : ''}`, 'aria-pressed': filter === id, onClick: () => setFilter(id ?? 'all') }, label)), h('span', { class: 'sync-line' }, toolStore.saved.value ? 'Saved in this browser' : 'Not saved: this browser blocks storage')),
      h('div', { class: 'tool-table-wrap' }, h('table', { class: 'tool-table' }, h('thead', null, h('tr', null, ...['Drawing', 'Tool', 'Diameter', 'Flutes', 'Material', 'Notes'].map(label => h('th', { scope: 'col' }, label)))),
        h('tbody', null, toolsByNumber(tools.filter(t => filter === 'all' || t.tool.type === filter)).map(e => h('tr', { key: e.tool.id, tabindex: 0, 'aria-selected': selected === e.tool.id, 'data-tool-row': e.number, onClick: () => setSelected(e.tool.id), onKeyDown: (event: KeyboardEvent) => { if (event.key === 'Enter') setSelected(e.tool.id); } },
          h('td', { class: 't-art' }, h(ToolDrawing, { tool: e.tool, thumb: true })),
          h('td', null, h('button', { type: 'button', class: 'row-link', onClick: () => setSelected(e.tool.id) }, h('strong', null, `T${e.number} · ${toolDisplayName(e.tool)}`)), h('small', null, TOOL_KINDS[e.tool.type])),
          h('td', { class: 'num' }, `${formatLength(e.tool.geometry.diameter, unit)} ${unit}`), h('td', null, String(e.tool.geometry.flutes)), h('td', null, `${e.tool.toolMaterial === 'hss' ? 'HSS' : e.tool.toolMaterial}${e.tool.coating === 'uncoated' ? '' : ` · ${e.tool.coating}`}`), h('td', { class: 'used' }, e.tool.notes || 'No notes'))))))),
    adding || current !== null ? h(ToolModal, { key: current?.tool.id ?? 'new', entry: adding ? null : current, onClose: () => { setAdding(false); setSelected(null); } }) : null,
  );
}
