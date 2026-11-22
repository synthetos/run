import type { BuildInfo } from '../build-info/buildInfo.ts';
import { linkDiagnosticsSnapshot, type BootloaderLink, type EventLog } from '@synthetos/machine';

declare const __RUN_BUILD__: BuildInfo;

/** Lifecycle evidence beside the raw byte transcript; bounded even through repeated recovery probes. */
export class FlashEntryTrace {
  readonly #links: Pick<BootloaderLink, 'diagnostics'>[] = [];
  readonly workerBuild = typeof __RUN_BUILD__ === 'undefined' ? null : __RUN_BUILD__;
  viaBoot = false;
  omittedLinks = 0;
  readonly runId: number;
  readonly recovery: boolean;
  constructor(runId: number, recovery: boolean) { this.runId = runId; this.recovery = recovery; }
  track(link: Pick<BootloaderLink, 'diagnostics'>): void {
    if (this.#links.length === 8) { this.#links.shift(); this.omittedLinks++; }
    this.#links.push(link);
  }
  json(): string {
    return JSON.stringify({ workerBuild: this.workerBuild, runId: this.runId, recovery: this.recovery,
      viaBoot: this.viaBoot, omittedLinks: this.omittedLinks,
      links: this.#links.map((link) => linkDiagnosticsSnapshot(link.diagnostics)) }, null, 2);
  }
}

export function flashTranscriptReport(log: EventLog | null, trace: FlashEntryTrace | null) {
  if (log === null || log.truncated) return null;
  return Object.freeze({ jsonl: log.toJsonl(), events: log.events().length, entryJson: trace?.json() ?? null });
}
