import { h, type ComponentChild } from 'preact';
import type { BoardPanel, BoardPanelSet } from '@synthetos/schema';

const OUTPUT_TITLES = {
  spindleEnable: 'Spindle enable',
  spindleDirection: 'Spindle direction',
  spindlePwm: 'Spindle speed (PWM)',
  coolant: 'Coolant',
  coolantMist: 'Mist coolant',
  coolantFlood: 'Flood coolant',
} as const;

function panel(p: BoardPanel): ComponentChild {
  switch (p.kind) {
    case 'motors':
      return h('section', { 'data-panel': 'motors', 'aria-label': 'Motors' }, `${p.count} motors`, p.driver === undefined ? null : `, ${p.driver}`);
    case 'inputs':
      return h('section', { 'data-panel': 'inputs', 'aria-label': 'Inputs' }, `${p.functions.length} switch inputs`);
    case 'output':
      return h(
        'section',
        { 'data-panel': `output:${p.id}`, 'aria-label': OUTPUT_TITLES[p.id] },
        OUTPUT_TITLES[p.id],
        p.mcu === undefined ? null : h('span', { class: 'pin' }, ` ${p.mcu}`),
        p.polarityToken === undefined ? null : h('code', null, ` ${p.polarityToken}`),
      );
    case 'adc':
      return h('section', { 'data-panel': 'adc', 'aria-label': 'Analog inputs' }, p.channels.join(', '));
    case 'connectors':
      return h('section', { 'data-panel': 'connectors', 'aria-label': 'Connectors' }, p.ids.join(', '));
    case 'ratings':
      return h('section', { 'data-panel': 'ratings', 'aria-label': 'Ratings' }, `${p.ids.length} ratings`);
  }
}

/**
 * The board panel set (ROADMAP TB-05a): one panel per capability the board
 * definition lists, nothing else. When the board is not known exactly the
 * notice comes first, as an alert, so it cannot be missed.
 */
export function BoardPanels({ set }: { readonly set: BoardPanelSet }): ComponentChild {
  return h(
    'div',
    { class: 'board-panels', 'data-board': set.boardId },
    h('h2', null, set.title),
    set.notice === undefined ? null : h('div', { role: 'alert', 'data-notice': 'board' }, h('strong', null, set.notice.text), ' ', set.notice.detail),
    set.panels.map(panel),
  );
}
