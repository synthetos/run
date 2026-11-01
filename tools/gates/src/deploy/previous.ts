/**
 * Which previous `run-deployed-<env>` artifact the deploy job may trust for
 * asset retention (ROADMAP P0-04; see retention.ts).
 *
 * Any workflow run can upload an artifact with any name, including a pull
 * request run of a modified ci.yml from a fork. Retained assets are served on
 * run's origin next to the serial grant, so the state is accepted only from
 * a run that this repository's reviewed `main` produced:
 * - the artifact has the exact expected name and has not expired;
 * - its run was for this repository, from this repository (not a fork),
 *   on branch `main`;
 * - the run itself (fetched separately) was a `push` event of
 *   `.github/workflows/ci.yml` on `main` in this repository. A pull request
 *   run is never a push, so it can never qualify.
 *
 * The state is still only a claim: any job of such a run can upload an
 * artifact of that name. Retention binds every retained file to the
 * attested build manifest of its commit (retention.ts); `selectBuildRun`
 * finds the run whose attested `run-web` holds that manifest.
 *
 * Dependency-free.
 */

export interface ArtifactSummary {
  readonly id: number;
  readonly name: string;
  readonly expired: boolean;
  readonly created_at: string;
  readonly workflow_run?: {
    readonly id: number;
    readonly repository_id: number;
    readonly head_repository_id: number;
    readonly head_branch: string;
  };
}

export interface RunSummary {
  readonly id: number;
  readonly event: string;
  readonly head_sha?: string;
  readonly created_at?: string;
  readonly head_branch: string;
  readonly path: string;
  readonly repository: { readonly id: number };
  readonly head_repository: { readonly id: number };
}

export const WORKFLOW_PATH = '.github/workflows/ci.yml';

export function deployedArtifactName(env: string): string {
  return `run-deployed-${env}`;
}

/**
 * Picks the newest acceptable artifact from a GitHub `GET
 * /repos/{repo}/actions/artifacts?name=...` response. Returns its run id, or
 * null when none qualifies.
 */
export function selectPreviousRun(response: unknown, name: string, repositoryId: number): number | null {
  const list = (response as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(list)) throw new Error('artifacts response has no artifacts array');
  const candidates = (list as ArtifactSummary[]).filter(
    (a) =>
      a.name === name &&
      a.expired === false &&
      a.workflow_run !== undefined &&
      a.workflow_run.repository_id === repositoryId &&
      a.workflow_run.head_repository_id === repositoryId &&
      a.workflow_run.head_branch === 'main' &&
      Number.isInteger(a.workflow_run.id) &&
      !Number.isNaN(Date.parse(a.created_at)),
  );
  candidates.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  return candidates[0]?.workflow_run?.id ?? null;
}

/** Problems with a `GET /repos/{repo}/actions/runs/{id}` response; empty means trusted. */
export function checkPreviousRun(response: unknown, runId: number, repositoryId: number): string[] {
  const run = response as Partial<RunSummary>;
  const problems: string[] = [];
  if (run.id !== runId) problems.push(`run id ${String(run.id)} is not ${runId}`);
  if (run.event !== 'push') problems.push(`event is '${String(run.event)}', not 'push'`);
  if (run.head_branch !== 'main') problems.push(`branch is '${String(run.head_branch)}', not 'main'`);
  if (run.path !== WORKFLOW_PATH) problems.push(`workflow is '${String(run.path)}', not '${WORKFLOW_PATH}'`);
  if (run.repository?.id !== repositoryId) problems.push('run is not in this repository');
  if (run.head_repository?.id !== repositoryId) problems.push('run head is not this repository');
  return problems;
}

/**
 * The run that built and attested `commit`: from a GitHub `GET
 * /repos/{repo}/actions/workflows/ci.yml/runs?head_sha=...` response, the
 * newest run that `checkPreviousRun` trusts and whose head is exactly that
 * commit. Null when there is none (its assets are then not retained).
 */
export function selectBuildRun(response: unknown, commit: string, repositoryId: number): number | null {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('commit must be a full 40-character sha');
  const list = (response as { workflow_runs?: unknown }).workflow_runs;
  if (!Array.isArray(list)) throw new Error('runs response has no workflow_runs array');
  const ok = (list as Partial<RunSummary>[]).filter(
    (r) => typeof r.id === 'number' && r.head_sha === commit && checkPreviousRun(r, r.id, repositoryId).length === 0 && !Number.isNaN(Date.parse(r.created_at ?? '')),
  );
  ok.sort((a, b) => Date.parse(b.created_at as string) - Date.parse(a.created_at as string) || (b.id as number) - (a.id as number));
  return ok[0]?.id ?? null;
}
