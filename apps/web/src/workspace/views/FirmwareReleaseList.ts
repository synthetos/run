/**
 * Release list presentation, separate from the stateful firmware workflow. Owner walk 2026-11-19 (no scrolling):
 * each release is one fixed-height row (version and tags, title and one line of detail, its actions), and the rows
 * page to fit the panel. The technical notes are the title's tooltip at Simple, one line at Advanced.
 */
import { h, type ComponentChild } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { releasesForHardware, supportsFirmware, type FirmwareRelease } from '@synthetos/protocol';
import type { FirmwareHubView } from '../model.ts';
import { Pager, pageOf, usePageSize } from '../paging.ts';
import { releaseTitle } from '../../firmware/releaseTitle.ts';
export const DOWNGRADE_NOTE = 'An older build starts with every setting at its default. Run backs your settings up first and puts them back afterwards; check them before you cut.';
const fbText = (fb: number): string => fb.toFixed(2);
const shortSha = (sha: string): string => `${sha.slice(0, 4)}…${sha.slice(-4)}`;
/** Row heights (CSS `.releases li`, `.releases.adv li`): Advanced shows two more lines. */
const ROW_PX = { simple: 76, advanced: 112 } as const;
interface Props {
  readonly hub: FirmwareHubView | null;
  readonly shown: { readonly fb: number | null; readonly hv: number | null; readonly kind: string };
  readonly advanced: boolean;
  readonly focusRelease: string | null;
  readonly blocked: string | null;
  readonly running: boolean;
  readonly fetching: boolean;
  readonly enabled: boolean;
  readonly pick: (release: FirmwareRelease) => void;
  readonly pickLocal: (release: FirmwareRelease, text: string) => void;
}
interface RowProps extends Props { readonly r: FirmwareRelease; readonly installed: boolean; readonly older: boolean }
function Version({ r, older }: RowProps): ComponentChild {
  return h('div', { class: 'rel-ver' },
    h('strong', null, fbText(r.fb)), h('small', null, r.date),
    r.prerelease ? h('span', { class: 'tag' }, 'Pre-release') : null,
    r.recommended ? h('span', { class: 'tag ok' }, 'Recommended') : null,
    older && !r.recommended ? h('span', { class: 'tag' }, 'Older') : null,
    r.simulatorOnly ? h('span', { class: 'tag mock' }, 'Simulated board only') : null);
}
function ImageDetails({ r, installed }: RowProps): ComponentChild {
  const source = r.repo !== null && r.tag !== null ? `GitHub Releases: ${r.repo} ${r.tag}` : r.simulatorOnly ? 'simulated image' : 'bundled with this site';
  return h('p', { class: 'installed' }, `${r.file} · sha256 ${shortSha(r.sha256)} · ${Math.round(r.size / 1024)} KB · ${source}${installed ? ' · installed' : ''}`);
}
function RowActions({ r, blocked, running, fetching, enabled, installed, older, pick, pickLocal }: RowProps): ComponentChild {
  const disabled = blocked !== null || running || fetching || r.unavailable !== undefined;
  const label = installed ? 'Flash again' : older ? `Install older version ${fbText(r.fb)} (downgrade)` : `Update to ${fbText(r.fb)}`;
  return h('div', { class: 'row-actions' },
    h('button', { type: 'button', class: r.recommended ? 'primary small' : 'small', 'data-machine-control': 'flash', 'data-action': 'update-release', disabled: disabled || !enabled, title: blocked ?? undefined, onClick: () => pick(r) }, label),
    h('label', { class: `small file-pick${disabled ? ' disabled' : ''}` }, 'Use a local copy…',
      h('input', { type: 'file', accept: '.hex', class: 'sr-only', disabled, 'data-machine-control': 'flash', 'data-action': 'release-local', onChange: (e: Event) => {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file !== undefined) void file.text().then(text => pickLocal(r, text));
        input.value = '';
      } })));
}
/** The lines under the title: why it can't be fetched, the downgrade note (safety text, always shown), read-only, installed. */
function Detail({ r, installed, older }: RowProps): ComponentChild {
  return [
    r.unavailable ? h('p', { key: 'unavailable', role: 'status' }, r.unavailable) : null,
    older ? h('p', { key: 'downgrade', class: 'fine', 'data-release-note': 'downgrade', title: DOWNGRADE_NOTE }, DOWNGRADE_NOTE) : null,
    !supportsFirmware(r.dialect, r.fb) && !r.simulatorOnly ? h('p', { key: 'read-only' }, 'Run will connect read-only to this version until Run is updated.') : null,
    installed ? h('p', { key: 'installed', class: 'installed' }, 'Installed on this board') : null,
  ];
}
function Notes(props: RowProps): ComponentChild {
  const { r, advanced } = props;
  return h('div', { class: 'rel-notes' },
    h('h3', { 'data-release-title': '', title: r.changelog }, `${releaseTitle(r)}${advanced ? ` · fv ${r.fv}` : ''}`),
    h(Detail, props),
    advanced ? h('p', { class: 'changelog', title: r.changelog }, r.changelog) : null,
    advanced ? h(ImageDetails, props) : null);
}
function ReleaseRow(props: Props & { readonly r: FirmwareRelease }): ComponentChild {
  const { r, shown, focusRelease } = props;
  const installed = shown.fb !== null && Math.round(shown.fb * 100) === Math.round(r.fb * 100);
  const older = shown.fb !== null && Math.round(r.fb * 100) < Math.round(shown.fb * 100);
  const row = { ...props, installed, older };
  return h('li', { key: r.file, 'data-release': r.file, 'data-release-age': installed ? 'installed' : older ? 'older' : 'newer', 'data-release-source': r.repo === null ? 'site' : 'github',
    ...(focusRelease === r.file ? { class: 'release-focus', 'data-release-focus': '' } : {}),
  }, h(Version, row), h(Notes, row), h(RowActions, row));
}
/** The releases, one page at a time; the page holding a release asked for (the update offer) comes first. */
function Rows(props: Props & { readonly releases: readonly FirmwareRelease[] }): ComponentChild {
  const box = useRef<HTMLDivElement | null>(null);
  const size = usePageSize(box, props.advanced ? ROW_PX.advanced : ROW_PX.simple);
  const [page, setPage] = useState(0);
  const focus = props.releases.findIndex((r) => r.file === props.focusRelease);
  const shown = pageOf(props.releases, focus >= 0 && Number.isFinite(size) ? Math.floor(focus / size) : page, size);
  return [
    h('div', { key: 'rows', class: 'releases-page', ref: box }, h('ul', { class: `releases${props.advanced ? ' adv' : ''}` }, shown.items.map((r) => h(ReleaseRow, { ...props, r, key: r.file })))),
    h(Pager, { key: 'pager', name: 'releases', page: shown.page, pages: shown.pages, onPage: setPage }),
  ];
}
export function FirmwareReleaseList(props: Props): ComponentChild {
  const { hub, shown } = props;
  const hw = hub?.releases.ok ? releasesForHardware(hub.releases.list, shown.hv) : null;
  const content = hub === null || !hub.releases.ok
    ? h('p', { class: 'fine pad', 'data-releases': 'none' }, hub === null || hub.releases.ok ? 'Loading the GitHub release list…' : `No GitHub release list for this site: ${hub.releases.reason}.`)
    : hw === null || hw.releases.length === 0
      ? h('p', { class: 'fine pad', 'data-releases': 'empty' }, shown.kind !== 'none' ? `No release for hardware version ${shown.hv ?? 'unknown'} yet.` : 'Connect a board to see the releases for its hardware.')
      : h(Rows, { ...props, releases: hw.releases });
  return h('div', { class: 'release-list' }, h('div', { class: 'section-heading tight' }, h('h2', null, 'Releases'), h('span', { class: 'fine' }, 'GitHub releases for this board’s hardware')), content);
}
