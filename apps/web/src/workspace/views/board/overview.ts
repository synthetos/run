import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import {
  pinByRef,
  settingsOf
} from '../../boardFacts.ts';
import { type LiveView } from '../../model.ts';
import { Dismissable } from '../../notes/Dismissable.ts';
import { TabBar, TabPane } from '../../ui.ts';
import { BoardFacts } from './identity.ts';
import { BoardIllustration } from './illustration.ts';
import { MotorDraft } from './motorDraft.ts';
import { PinCard } from './pin.ts';

type OverviewSide = 'board' | 'pin';

export function OverviewTab({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [selected, setSelected] = useState<string | null>(null);
  const [side, setSide] = useState<OverviewSide>('board');
  const settings = settingsOf(view);
  const pin = selected === null ? null : pinByRef(selected);
  const select = (ref: string): void => {
    setSelected(ref);
    setSide('pin');
  };
  return h(
    'div',
    { class: 'configure-grid' },
    h(
      'div',
      { class: 'viewer board-canvas' },
      h('div', { class: 'viewer-top' }, h('span', { class: 'viewer-label' }, 'TinyG v8 · choose any terminal')),
      h(BoardIllustration, { selected, onSelect: select, settings }),
      h('div', { class: 'viewer-foot' }, h(Dismissable, { id: 'board/drawing-source', label: 'where the drawing comes from', inNotes: false }, 'Drawn from public information about the board · pin names from the board definition · check your board’s revision')),
    ),
    h(
      'aside',
      { class: 'inspector tabbed', 'aria-label': 'Board' },
      h(TabBar<OverviewSide>, { label: 'Board details', prefix: 'bside', variant: 'underline', current: side, onSelect: setSide, tabs: [{ id: 'board', label: 'This board' }, { id: 'pin', label: pin === null ? 'Selected pin' : pin.ref }] }),
      h(TabPane, { prefix: 'bside', id: 'board', current: side, class: 'tpane insp-scroll' }, h(BoardFacts, { view })),
      h(
        TabPane,
        { prefix: 'bside', id: 'pin', current: side, class: 'tpane insp-scroll' },
        pin === null
          ? h('section', { class: 'insp' }, h('p', { class: 'fine' }, 'Select a pin to see its wiring and settings.'))
          : pin.role === 'motor'
            ? [h(PinCard, { key: 'card', pin, view, onClose: () => setSelected(null) }), h(MotorDraft, { key: 'draft', motor: Number(pin.connector.slice(1)), view })]
            : h(PinCard, { pin, view, onClose: () => setSelected(null) }),
      ),
    ),
  );
}
