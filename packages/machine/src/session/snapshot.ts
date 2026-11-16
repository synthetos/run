/** Workspace projection includes its job and probe views. */
import { snapshotOf as project } from './snapshotCore.ts';
import { jobView } from './jobSnapshot.ts';
import { probeView } from './probe/view.ts';
import { overrideView, type OverrideView } from './overrides/model.ts';
import type { SessionState } from './types.ts';
export { SNAPSHOT_STRING_MAX } from './snapshotCore.ts';
export type { JobView } from './snapshotCore.ts';
export type SessionSnapshot = import('./snapshotCore.ts').SessionSnapshot & { readonly overrides?: OverrideView | null };
export const snapshotOf = (state: SessionState) => Object.freeze({ ...project(state, { job: jobView, probe: probeView }), overrides: overrideView(state) });
