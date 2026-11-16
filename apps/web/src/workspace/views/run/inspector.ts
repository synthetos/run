import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import type { MotionAxis } from '../../../machine-worker/rpc.ts';
import { outputsOff } from '../../controlBlock.ts';
import { currentBlock } from '../../ControlBlockCard.ts';
import { HomeQuick, HomeSection } from '../../homing.ts';
import { MachineInsight } from '../../insight/MachineInsight.ts';
import { uiLevel } from '../../jobWorkflow.ts';
import { type WorkspaceModel } from '../../model.ts';
import { TabBar, TabPane } from '../../ui.ts';
import { JobStopCard, type StopHooks } from '../JobViews.ts';
import { JogSection } from './jog.ts';
import { ZeroSection } from './offsets.ts';
import { PositionPanel } from './position.ts';
import { SpindleSection } from './spindle.ts';

type InspTab = 'jog' | 'home' | 'zero' | 'spindle';

/** The Run inspector: position always on top, the rest as tabs so nothing needs a long scroll. */
export function RunInspector({ model, stops, fileTool = null }: { readonly model: WorkspaceModel | null; readonly stops: StopHooks; readonly fileTool?: number | null }): ComponentChild {
  const [tab, setTab] = useState<InspTab>('jog');
  const [ask, setAsk] = useState<{ readonly axes: readonly MotionAxis[]; readonly at: number } | null>(null);
  const simple = uiLevel.value.value !== 'advanced';
  // While a block holds, the Position panel's card says why and nothing that cannot work is drawn (owner, 2026-11-09):
  // no jog, home or offsets. The spindle shows only while it or the coolant may be on, for its Off (never gated).
  if (currentBlock(model) !== null) {
    return h(
      'aside',
      { class: `inspector run-inspector blocked${simple ? ' simple' : ''}`, 'aria-label': 'Machine', 'data-ui-level': simple ? 'simple' : 'advanced', 'data-blocked': 'true' },
      h(JobStopCard, { model, ...stops }),
      h(PositionPanel, { model }),
      outputsOff(model?.live.value ?? null) ? null : h('div', { class: simple ? 'simple-pane' : 'insp-pane' }, h(SpindleSection, { model, compact: simple })),
    );
  }
  if (simple) {
    // Simple (OD-13): one screen, no tabs. Position with Zero/Go, the jog pad, Home all / Set machine zero here, the spindle row.
    return h(
      'aside',
      { class: 'inspector run-inspector simple', 'aria-label': 'Machine', 'data-ui-level': 'simple' },
      h(JobStopCard, { model, ...stops }),
      h(PositionPanel, { model }),
      h('div', { class: 'simple-pane' }, h(JogSection, { model, onGoToZero: (axes) => setAsk({ axes, at: Date.now() }) }), h(HomeQuick, { model }), h(SpindleSection, { model, compact: true })),
      ask === null ? null : h(ZeroSection, { model, ask, goOnly: true }),
    );
  }
  return h(
    'aside',
    { class: 'inspector run-inspector', 'aria-label': 'Machine', 'data-ui-level': 'advanced' },
    h(JobStopCard, { model, ...stops, onZeroZ: () => setTab('zero') }),
    h(PositionPanel, { model }),
    h(
      'div',
      { class: 'insp-tabs' },
      h(TabBar<InspTab>, {
        label: 'Machine controls',
        prefix: 'insp',
        variant: 'underline',
        current: tab,
        onSelect: setTab,
        tabs: [
          { id: 'jog', label: 'Jog' },
          { id: 'home', label: 'Home' },
          { id: 'zero', label: 'Offsets' },
          { id: 'spindle', label: 'Spindle' },
        ],
      }),
    ),
    h(TabPane, { prefix: 'insp', id: 'spindle', current: tab, class: 'tpane insp-pane' }, h(SpindleSection, { model })),
    h(
      TabPane,
      { prefix: 'insp', id: 'jog', current: tab, class: 'tpane insp-pane' },
      h(JogSection, {
        model,
        onGoToZero: (axes) => {
          setAsk({ axes, at: Date.now() });
          setTab('zero');
        },
      }),
    ),
    h(TabPane, { prefix: 'insp', id: 'home', current: tab, class: 'tpane insp-pane' }, h(HomeSection, { model })),
    h(TabPane, { prefix: 'insp', id: 'zero', current: tab, class: 'tpane insp-pane' }, h(ZeroSection, { model, ask })),
    // Advanced only (owner, 2026-11-09): the planner and the cutting numbers, read only, under the controls.
    h(MachineInsight, { model, fileTool }),
  );
}
