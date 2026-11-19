import { h, type ComponentChild } from 'preact';
import type { ReadoutPhase } from '../../../live/readout.ts';
import { SettingsStatus } from '../../../machine-ui/SettingsView.ts';
import { type WorkspaceModel } from '../../model.ts';
import { Dismissable } from '../../notes/Dismissable.ts';
import { AllSettings } from '../../settings/AllSettings.ts';

/** All settings at both levels (Board settings spec §5.7, OD-44 Q2); the guided form stays in the Machines view. */
export function SettingsTab({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  return h(
    'div',
    { tabindex: 0, class: 'scroll-region settings-tab' },
    settingsRead(view?.readout.phase ?? { kind: 'idle' }, () => model?.actions.value?.keepBoardSettings()),
    h(AllSettings, { view }),
  );
}

/**
 * The settings read's outcome. "Recorded" and "match" are only information, so they get a × (remembered per notice,
 * workspace/notes/Dismissable.ts); reading, incomplete and a drift (a review is needed) always show.
 */
function settingsRead(phase: ReadoutPhase, onKeep: () => void): ComponentChild {
  const body = h('div', { 'data-region': 'settings' }, h(SettingsStatus, { phase, onKeep }));
  return phase.kind === 'recorded' || phase.kind === 'match'
    ? h(Dismissable, { id: `board/settings-${phase.kind}`, label: 'the settings read note', inNotes: false, class: 'settings-read dismissable-card' }, body)
    : h('div', { class: 'settings-read' }, body);
}
