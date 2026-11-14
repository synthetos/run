/** Separate update entry: no workspace shell, account or control worker. */
import { render, h } from 'preact';
import { startFirmwareWorker } from '../machine-worker/firmwareClient.ts';
import { installTrustedTypes } from '../security/tt.ts';
import { startTheme } from '../theme/theme.ts';
import { portChooserAvailable } from '../live/portChooser.ts';
import { UpdateController } from '../update/controller.ts';
import { UpdateFlow } from '../update/UpdateFlow.ts';
import '../styles/base.css';
import '../styles/update.css';

const trustedTypes = installTrustedTypes();
startTheme();
const safetyBar = document.querySelector<HTMLElement>('[data-region="safety-bar"]');
if (safetyBar !== null) {
  const measure = (): void => document.documentElement.style.setProperty('--update-safety-height', `${safetyBar.getBoundingClientRect().height}px`);
  measure();
  new ResizeObserver(measure).observe(safetyBar);
}
const root = document.getElementById('firmware-update');
const supported = trustedTypes !== null && portChooserAvailable();
if (root !== null) {
  root.replaceChildren();
  render(h(UpdateFlow, { controller: null, supported, failure: null }), root);
  if (supported) {
    const worker = startFirmwareWorker(trustedTypes);
    if (worker !== null) {
      const controller = new UpdateController(worker);
      void controller.init().then(() => render(h(UpdateFlow, { controller, supported, failure: null }), root)).catch(() => {
        worker.terminate();
        render(h(UpdateFlow, { controller: null, supported: false, failure: 'Run could not open local backup storage. Allow this site to store data, then reload. Nothing was connected.' }), root);
      });
    }
  }
}
document.documentElement.dataset['ready'] = 'true';
