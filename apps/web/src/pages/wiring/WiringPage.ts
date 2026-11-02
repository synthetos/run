import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { BOARD_DEFINITIONS } from '@synthetos/schema';
import { ARDUINO_DUE_GSHIELD, emptyDiagram, type Diagram, type Dialect, type Paper, type WiringBoard } from '@synthetos/wiring';
import type { BuildInfo } from '../../build-info/buildInfo.ts';
import { StaticPage } from '../StaticPage.ts';
import { WiringEditor } from '../../wiring/WiringEditor.ts';

/** Boards with connector data (TB-05a overlays), then the diagram-only Due + gShield. */
export const WIRING_BOARDS: readonly WiringBoard[] = [...BOARD_DEFINITIONS.filter((b) => (b.connectors ?? []).length > 0), ARDUINO_DUE_GSHIELD];

export type ExportHandler = (diagram: Diagram, board: WiringBoard, dialect: Dialect, paper: Paper) => string;

function Workbench({ onExport }: { readonly onExport?: ExportHandler | undefined }): ComponentChild {
  const [boardId, setBoardId] = useState((WIRING_BOARDS[0] as WiringBoard).id);
  const [firmware, setFirmware] = useState<'tinyg-en' | 'tinyg-440'>('tinyg-en');
  const board = WIRING_BOARDS.find((b) => b.id === boardId) ?? (WIRING_BOARDS[0] as WiringBoard);
  const dialect: Dialect = board.family === 'tinyg' ? firmware : board.family === 'g2core' ? 'g2core' : 'unknown';
  return h(
    'div',
    { class: 'wiring-workbench' },
    h(
      'div',
      { class: 'wiring-row' },
      h('label', { for: 'wiring-board' }, 'Board', h('select', { id: 'wiring-board', value: board.id, onChange: (e: Event) => setBoardId((e.currentTarget as HTMLSelectElement).value) }, WIRING_BOARDS.map((b) => h('option', { value: b.id, key: b.id }, b.name)))),
      board.family === 'tinyg'
        ? h(
            'label',
            { for: 'wiring-firmware' },
            'Firmware',
            h(
              'select',
              { id: 'wiring-firmware', value: firmware, onChange: (e: Event) => setFirmware((e.currentTarget as HTMLSelectElement).value as 'tinyg-en' | 'tinyg-440') },
              h('option', { value: 'tinyg-en' }, 'TinyG edge-next (450.01)'),
              h('option', { value: 'tinyg-440' }, 'TinyG 440.21'),
            ),
          )
        : null,
    ),
    h('p', { class: 'wiring-board-note' }, 'TinyG v6 and v7 have no connector data yet, so they have no diagram.'),
    h(WiringEditor, { key: board.id, board, dialect, initial: emptyDiagram(board.id), onExport }),
  );
}

/**
 * https://run.synthetos.com/wiring/ — the wiring diagram editor (ROADMAP
 * TB-05). It never talks to a machine; expected settings go to a draft only.
 */
export function WiringPage({ build, onExport }: { readonly build: BuildInfo; readonly onExport?: ExportHandler }): ComponentChild {
  return h(
    StaticPage,
    { build, current: '/wiring/' },
    h(
      'div',
      { class: 'page-head' },
      h('p', { class: 'label' }, 'run.synthetos.com · Wiring'),
      h('h1', null, 'Wiring diagram'),
      h('p', { class: 'lede' }, 'Draw how your machine is wired to the board. Every rule cites its source. This page never talks to a machine, and it does not replace a qualified electrician.'),
    ),
    h(Workbench, { onExport }),
  );
}
