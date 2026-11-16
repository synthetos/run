/** Plain-text GitHub metadata; a downloadable version need not be supported for control. */
import { h } from 'preact';
import { releasesForHardware, supportsFirmware, type FirmwareRelease, type HardwareReleases } from '@synthetos/protocol';
import type { FirmwareHubView } from '../workspace/model.ts';
interface Props {
  readonly list: HardwareReleases | null;
  readonly failure: string | null;
  readonly blocked: string | null;
  readonly busy: boolean;
  readonly pick: (release: FirmwareRelease) => void;
}
export function ReleaseChoices({ list, failure, blocked, busy, pick }: Props) {
  return h('section', { class: 'update-card', 'data-step': 'release' },
    h('h2', null, 'Choose a GitHub release'),
    blocked ? h('p', { role: 'status' }, blocked) : null,
    failure ? h('p', { role: 'status' }, `The GitHub release list is unavailable: ${failure}. Reload to try again.`) : null,
    !list?.releases.length ? h('p', null, 'No release is listed for this hardware yet.') : h('ul', { class: 'update-list' }, list.releases.map(r => h('li', { key: r.file, 'data-release': r.file },
      h('div', null, h('strong', null, `Firmware ${r.fb.toFixed(2)}`), h('p', null, `${r.date}${r.prerelease ? ' · Pre-release' : ''}`), h('details', null, h('summary', null, 'Release notes'), h('p', { style: 'white-space: pre-wrap' }, r.changelog)),
        !supportsFirmware(r.dialect, r.fb) ? h('p', null, 'Run will connect read-only to this version until Run is updated.') : null,
        r.unavailable ? h('p', { role: 'status' }, r.unavailable) : null),
      h('button', { class: 'primary', disabled: blocked !== null || busy || r.unavailable !== undefined, onClick: () => pick(r) }, `Install ${r.fb.toFixed(2)}`)))));
}

/** Keep the live catalog's availability and download state out of the update flow. */
export function UpdateReleaseChoices({ hub, hv, blocked, selecting, pick }: {
  readonly hub: FirmwareHubView | null;
  readonly hv: number | string | null;
  readonly blocked: string | null;
  readonly selecting: boolean;
  readonly pick: (release: FirmwareRelease) => void;
}) {
  const list = hub?.releases.ok ? releasesForHardware(hub.releases.list, typeof hv === 'number' ? hv : null) : null;
  const failure = hub?.releases.ok === false ? hub.releases.reason : null;
  const busy = selecting || hub?.download?.phase === 'fetching' || hub?.download?.phase === 'checking';
  return h(ReleaseChoices, { list, failure, blocked, busy, pick });
}
