import { h, type ComponentChild } from 'preact';
import { w1 } from '@synthetos/safety';
import { type BuildInfo, versionLabel } from '../build-info/buildInfo.ts';
import { WarningIcon } from './icons.ts';
import { signalText } from './signal.ts';

/** The tooltip of the stop button while no machine is connected (ROADMAP P0-05). */
export const STOP_UNAVAILABLE = 'Available when a machine is connected';

/** What the stop controls show (P1-06), from live/mount.ts after hydration. */
export interface StopBarView {
  /** The stop button acts: this tab is LIVE, or another tab of this browser controls (or controlled) a machine. */
  readonly available: boolean;
  /**
   * Something may be moving, held or queued (live/stopControls.ts `mayBeMoving`), or a controlling tab
   * was lost (W29): Pause and Stop job are shown prominently. Quiet otherwise. Never disables them.
   */
  readonly prominent: boolean;
  /** `held`: a report shows the held class (W30 plus W10). `pause-requested`: Pause was sent, no hold reported yet. */
  readonly band: 'held' | 'pause-requested' | null;
  /** The last stop request's result, per machine (SAFETY §4.3), and what was asked for. */
  readonly outcome: {
    readonly kind: 'delivered' | 'not-delivered';
    readonly action: 'pause' | 'stopJob' | 'spindleOff';
    readonly machines: readonly { readonly machine: string; readonly delivered: boolean }[];
    /** A delivered Pause pressed while this tab's machine was at rest (OD-6: "nothing changed"). */
    readonly idle?: boolean;
  } | null;
}

/** A machine lock name as the user reads it (the board id). */
export function machineLabel(lockName: string): string {
  return lockName.replace(/^synthetos-machine:/, '');
}

export interface SafetyBarProps {
  readonly build: BuildInfo;
  /**
   * `workspace`: W1 only, as one line at the top of the workspace; the machine
   * strip under the header carries the state band (W7, W6, W30), Pause and
   * Stop job (workspace/MachineStrip.ts). `page`: W1 and the version chip,
   * for the static pages, which have no machine context.
   */
  readonly variant: 'workspace' | 'page';
}

/**
 * The safety bar (SAFETY §5 W1, RUN_PLAN §7.1). At the top of every page,
 * never collapsible, covered or rearranged, and styled with the safety bar
 * tokens only, so nothing themed resembles it. Prerendered, so W1 shows
 * before and without JavaScript.
 */
export function SafetyBar({ build, variant }: SafetyBarProps): ComponentChild {
  const chip = h('span', { class: 'version-chip', 'data-version': '', title: `Version ${build.version}, commit ${build.sha}` }, versionLabel(build));
  return h(
    'div',
    { class: `safety-bar safety-bar-${variant}`, role: 'region', 'aria-label': 'Safety', 'data-region': 'safety-bar' },
    h(
      'div',
      { class: 'safety-bar-inner' },
      h('p', { class: 'safety-w1', 'data-safety': 'W1' }, WarningIcon(), h('span', null, ...signalText(w1()))),
      variant === 'page' ? h('div', { class: 'safety-status' }, chip) : null,
    ),
  );
}
