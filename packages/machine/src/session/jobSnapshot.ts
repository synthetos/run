import { forecastStartModes, startModesText } from './jobModes.ts';
import { cap, capLong, type JobView } from './snapshotCore.ts';
import type { SessionState, JobState } from './types.ts';

export function jobView(state: SessionState, job: JobState): JobView {
  const total = job.lines.length;
  const reported = state.live.line;
  const running = job.startedAt !== null;
  const exec = running && reported !== undefined && Number.isInteger(reported) && reported >= 1 && reported <= Math.max(job.next, 1) && reported <= total ? reported : null;
  const execIndex = exec === null ? Math.min(job.acked, total) : exec - 1;
  const fileLine = (i: number): number | null => (i >= 0 && i < total ? (job.lines[i] as JobState['lines'][number]).sourceLine : null);
  let inFlight = 0;
  for (const e of state.expected) if (e.purpose === 'job' && !e.late) inFlight++;
  let bound: number | null = 0;
  for (let i = execIndex; i < job.next && bound !== null; i++) {
    const m = job.lines[i]?.motion;
    if (m === null || m === undefined) continue;
    bound = m.boundMm === null ? null : bound + m.boundMm;
  }
  const secondsAt = (i: number): number => job.secondsFrom[Math.min(Math.max(i, 0), total)] ?? 0;
  const tc = job.toolChange;
  const mpo = state.live.mpo;
  const moved = tc !== null && (['x', 'y', 'z'] as const).some((a) => tc.at[a] !== undefined && (mpo[a] === undefined || Math.abs((mpo[a] as number) - (tc.at[a] as number)) > 0.01));
  const queuedLines = new Set(job.lines.slice(execIndex, job.next).map((l) => l.sourceLine));
  const active = ['running', 'draining', 'ending', 'pausing', 'paused', 'refused', 'outputsOff', 'toolChange', 'breakpoint', 'programStop', 'resuming'].includes(job.phase);
  return {
    id: job.id,
    name: cap(job.name),
    hash: job.hash,
    bytes: job.bytes,
    phase: job.phase,
    total,
    sent: job.next,
    acked: job.acked,
    free: job.free,
    inFlight,
    executing: exec === null ? null : { n: exec, line: fileLine(exec - 1) as number },
    sentThrough: job.next > 0 ? fileLine(job.next - 1) : null,
    ackedThrough: job.acked > 0 ? fileLine(job.acked - 1) : null,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    totalSeconds: secondsAt(0),
    remainingSeconds: running ? secondsAt(execIndex) : secondsAt(0),
    queuedSeconds: running ? Math.max(0, secondsAt(execIndex) - secondsAt(job.next)) : 0,
    queuedBoundMm: running ? bound : 0,
    stop: job.stop === null ? null : { kind: job.stop.kind, line: fileLine(job.stop.index) as number },
    refused: job.refused === null ? null : { line: fileLine(job.refused.index) as number, status: job.refused.status, text: cap(job.refused.text) },
    toolChange: tc === null ? null : { line: fileLine(tc.index) as number, tool: tc.tool, spindle: tc.spindle, speed: tc.speed, mist: tc.mist, flood: tc.flood, restartsSpindle: tc.restartsSpindle, moved },
    message: job.message === null ? null : capLong(job.message),
    events: job.events.map((e) => ({ ...e, text: capLong(e.text) })),
    breakpoints: job.breakpoints,
    queuedBreakpoints: active ? job.breakpoints.filter((b) => queuedLines.has(b) && b !== fileLine(job.passed ?? -1)) : [],
    report: job.report,
    rxmFrom: job.rxmFrom,
    jobFlag: job.jobFlag,
    feedLimit: job.feedLimit,
    faultStopAt: job.faultStopAt,
    stoppedAt: job.stoppedAt ?? null,
    stopping: job.stopping,
    startModes: startModesText(forecastStartModes(state, job.startModes?.needs ?? [])),
  };
}

