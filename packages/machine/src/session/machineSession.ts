/** Workspace session: the shared executor with the full control reducer and byte gate. */
import { SessionExecutor, type MachineSessionOptions } from './sessionExecutor.ts';
import { workspaceRuntime } from './workspaceRuntime.ts';
import { assertWorkspaceFeatures } from './workspaceFeatureContract.ts';
import { workspaceReducerFeatures } from './workspaceReducerFeatures.ts';
import type { OverrideRequest } from './overrides/model.ts';
import type { SessionIntent } from './types.ts';
import type { Decision } from '@synthetos/safety';
export { escape } from './sessionExecutor.ts';
export type { ConnectOutcome, LogEntry, MachineSessionOptions, SessionClock, TranscriptExport } from './sessionExecutor.ts';

export class MachineSession extends SessionExecutor {
  constructor(options: MachineSessionOptions) {
    assertWorkspaceFeatures(workspaceReducerFeatures);
    super(options, workspaceRuntime);
  }
  setOverride(override: OverrideRequest): Decision {
    const request: SessionIntent & { readonly override: OverrideRequest } = { intent: 'jobRuntime', override };
    return this.request(request);
  }
  /** Pause: `!` (SAFETY §4.4). Allowed whenever the port is open. */
  feedhold(): Decision {
    return this.request({ intent: 'feedhold' });
  }

  /** Phase 1 / READ_ONLY: `!` plus "Use your E-stop" (SAFETY §4.4). */
  stopJob(): Decision {
    return this.request({ intent: 'stopJob' });
  }

  /** Phase 1 / READ_ONLY: `!` plus "Use your E-stop" (SAFETY §4.4). */
  spindleOffNow(): Decision {
    return this.request({ intent: 'spindleOffNow' });
  }

  /**
   * Phase 3 (SAFETY §4.4a): load a job (the file text; the session sanitises it with the live board's values) or
   * unload it (null). Decided by the matrix and the session (jobs release, approved edge-next board, idle).
   */
  loadJob(job: { readonly name: string; readonly text: string; readonly c22?: boolean } | null): Decision {
    return this.request({ intent: 'loadJob', job: job === null ? null : { name: job.name, text: job.text, c22: job.c22 === true } });
  }

  /** Phase 3: start the loaded job, with the page's breakpoints and confirmations. */
  startJob(breakpoints: readonly number[], confirm: { readonly unhomed: boolean; readonly workZero: boolean; readonly spindle: boolean; readonly travel?: string | null }): Decision {
    return this.request({ intent: 'startJob', breakpoints: [...breakpoints], confirm: { ...confirm } });
  }

  /** Phase 3: the page's breakpoints for the loaded job. */
  setBreakpoints(lines: readonly number[]): Decision {
    return this.request({ intent: 'jobBreakpoints', lines: [...lines] });
  }

  /**
   * Phase 3 (H77): the page's remembered line-mode value for the board on link `epoch` (0 or 1), or null when it
   * remembers none. It writes nothing by itself; a board left in line mode outside a job is put back to it.
   */
  rememberLineMode(epoch: number, remembered: number | null): void {
    this.dispatch({ type: 'lineModeMemory', epoch, remembered });
  }

}
