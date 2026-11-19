/**
 * Board → Firmware → Update's release buttons: fetch the listed image from this site (the Worker's proxy for a GitHub
 * release) or check a local copy, then ask C6. A site-wide Update firmware asks for the same through
 * `updateRequest` (boardNavigation.ts, owner 169); it is taken once, and only when the row itself could start now.
 */
import { useEffect } from 'preact/hooks';
import type { FirmwareRelease, FirmwareReleases } from '@synthetos/protocol';
import type { Target } from '../../firmware/FlashViews.ts';
import { updateRequest } from '../boardNavigation.ts';
import type { FirmwareActions, FirmwareHubView } from '../model.ts';

export interface PickDeps {
  readonly actions: { readonly firmware?: FirmwareActions } | null;
  readonly hub: FirmwareHubView | null;
  readonly setMsg: (m: string | null) => void;
  readonly setTarget: (t: Target) => void;
  /** FirmwareReleaseList's own rule for its rows: not blocked, nothing running, nothing downloading. */
  readonly blocked: string | null;
  readonly running: boolean;
  readonly fetching: boolean;
}

export interface Pickers {
  readonly pick: (r: FirmwareRelease) => void;
  readonly pickLocal: (r: FirmwareRelease, text: string) => void;
}

/** A listed release by its file name, or null. */
export function listedRelease(releases: FirmwareReleases | null, file: string): FirmwareRelease | null {
  for (const board of releases?.boards ?? []) {
    const r = board.releases.find((x) => x.file === file);
    if (r !== undefined) return r;
  }
  return null;
}

/** Whether a release's row button could start now. */
function rowEnabled(d: PickDeps, r: FirmwareRelease | null): r is FirmwareRelease {
  return r !== null && r.unavailable === undefined && d.blocked === null && !d.running && !d.fetching;
}

export function useReleasePick(d: PickDeps): Pickers {
  const fw = d.actions?.firmware;
  const ask = (got: { readonly ok: true; readonly image: Extract<Target, { kind: 'release' }>['image'] } | { readonly ok: false; readonly message: string }): void => {
    if (got.ok) d.setTarget({ kind: 'release', image: got.image });
    else d.setMsg(got.message);
  };
  const pick = (r: FirmwareRelease): void => {
    if (fw === undefined) return;
    d.setMsg(null);
    void fw.downloadRelease(r).then(ask);
  };
  const pickLocal = (r: FirmwareRelease, text: string): void => {
    if (fw === undefined) return;
    d.setMsg(null);
    void fw.checkLocalCopy(r, text).then(ask);
  };
  const asked = updateRequest.value;
  useEffect(() => {
    if (asked === null) return;
    updateRequest.value = null;
    const r = listedRelease(d.hub?.releases.ok === true ? d.hub.releases.list : null, asked);
    if (rowEnabled(d, r)) pick(r);
  }, [asked]);
  return { pick, pickLocal };
}
