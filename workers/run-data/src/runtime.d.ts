/** Minimal runtime surface used by this Worker; no Node APIs enter the deployed code. */
declare module 'cloudflare:workers' {
  export class WorkerEntrypoint<Env> { protected env: Env }
}
