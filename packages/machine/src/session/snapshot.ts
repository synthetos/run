/** Workspace projection includes its job and probe views. */
import { snapshotOf as project } from './snapshotCore.ts';
import { jobView } from './jobSnapshot.ts';
import { probeView } from './probe/view.ts';
import type { SessionState } from './types.ts';
export { SNAPSHOT_STRING_MAX } from './snapshotCore.ts';
export type { JobView, SessionSnapshot } from './snapshotCore.ts';
export const snapshotOf = (state: SessionState) => project(state, { job: jobView, probe: probeView });
