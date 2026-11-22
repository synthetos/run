/** Bounded receive lifecycle state. The original stream error stays available inside the worker. */
export interface ReadDiagnostics {
  readonly portOpen: boolean;
  readonly readerAcquired: boolean;
  readonly readCompletions: number;
  readonly rxBytes: number;
  readonly ended: boolean;
  readonly error: unknown;
}
export interface LinkDiagnostics {
  portOpen: boolean;
  readerStarted: boolean;
  rxBytes: number;
  ended: boolean;
  error: unknown;
  readonly transport: ReadDiagnostics | null;
}
/** Only bounded error text crosses RPC; the in-worker record retains the original error object. */
export function readErrorText(error: unknown): string | null {
  if (error === null) return null;
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 512);
}
export function linkDiagnosticsSnapshot(d: LinkDiagnostics) {
  const transport = d.transport;
  return { ...d, error: readErrorText(d.error), transport: transport === null ? null : { ...transport, error: readErrorText(transport.error) } };
}
