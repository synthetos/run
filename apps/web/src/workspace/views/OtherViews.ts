/**
 * Settings and Safety views, plus the Analyze view export.
 */
import { h, type ComponentChild } from 'preact';
import { CANNOT_GUARANTEE, w1 } from '@synthetos/safety';
import { type BuildInfo, versionLabel } from '../../build-info/buildInfo.ts';
import { signalText } from '../../shell/signal.ts';
import { machineStore, myMaterialStore, toolStore } from '../library.ts';
import { jobSaved } from '../jobModel.ts';
import { Icon } from '../icons.ts';
import { openReport } from '../../report/state.ts';

function head(title: string, sub: string): ComponentChild {
  return h('div', { class: 'view-head' }, h('div', { class: 'title-block' }, h('h1', null, title), sub === '' ? null : h('p', null, sub)));
}

export { AnalyzeView } from './AnalyzeView.ts';

export function PreferencesView({ build }: { readonly build: BuildInfo }): ComponentChild {
  const saved = toolStore.saved.value && jobSaved.value;
  return h(
    'div',
    { class: 'settings-view' },
    head('Preferences', ''),
    h(
      'div',
      { tabindex: 0, class: 'scroll-region' },
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', null, 'Theme')),
        h('p', { class: 'fine' }, 'Follows your system until you choose.'),
        h('button', { type: 'button', class: 'small', 'data-theme-toggle': '', 'aria-label': 'Toggle day/night mode' }, 'Switch light or dark'),
      ),
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', null, 'Kept in this browser')),
        h(
          'dl',
          { class: 'facts' },
          h('div', null, h('dt', null, 'Machines'), h('dd', null, String(machineStore.value.value.length))),
          h('div', null, h('dt', null, 'Tools'), h('dd', null, String(toolStore.value.value.length))),
          h('div', null, h('dt', null, 'My materials'), h('dd', null, String(myMaterialStore.value.value.length))),
          h('div', null, h('dt', null, 'Storage'), h('dd', null, saved ? 'Available' : 'Blocked: changes last for this page only')),
        ),
        h('p', { class: 'fine' }, 'Stored on this device. Safety records are never synced.'),
      ),
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Version')), h('p', { class: 'mono' }, versionLabel(build))),
    ),
  );
}

export function SafetyView(): ComponentChild {
  return h(
    'div',
    { class: 'safety-view' },
    head('Safety', 'What this software does and does not do.'),
    h(
      'div',
      { tabindex: 0, class: 'scroll-region' },
      h('div', { class: 'panel' }, h('p', { class: 'safety-repeat' }, ...signalText(w1()))),
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', null, 'Pause and Stop job')),
        h('p', null, 'Pause and Stop job sit in the same place in every view and are never blocked by sign-in or by a mode. Escape pauses from anywhere. They are controlled stops sent over a channel that is not safety rated, and they may be delayed or never delivered.'),
        h('p', null, 'In this release Stop job sends a feedhold, like Pause. On TinyG a feedhold does not stop the spindle or coolant: use your E-stop to remove power.'),
      ),
      h(
        'div',
        { class: 'panel report-panel' },
        h('div', { class: 'panel-head' }, h('h2', null, 'Report a problem')),
        h('p', null, 'Something wrong with run, the firmware or the board? Run gathers what it already knows, shows you every piece before anything is posted, and opens the right place: run or firmware issues on GitHub, or the forum for questions. Reporting sends nothing to the machine.'),
        h('button', { type: 'button', class: 'small', 'data-action': 'report-problem', onClick: () => openReport({ origin: 'safety' }) }, Icon('flag', 14), 'Report a problem'),
      ),
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'What this tool cannot guarantee')), h('ol', { class: 'cannot-list' }, CANNOT_GUARANTEE.map((item) => h('li', { key: item }, item)))),
      h('p', { class: 'fine' }, 'The full safety contract is at ', h('a', { href: '/safety/', target: '_blank', rel: 'noopener' }, 'run.synthetos.com/safety'), ' (opens in a new tab, so this workspace keeps its connection).'),
    ),
  );
}
