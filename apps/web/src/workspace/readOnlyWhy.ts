/**
 * Why a session is read only, in plain words, from the classification's own reason and the board's build. Shared by
 * the Position panel's control card (controlBlock.ts) and the machine strip (status.ts). Pure.
 */
import type { SnapshotMessage } from '../machine-worker/rpc.ts';

type Snapshot = SnapshotMessage['snapshot'];

/** The board's build in plain words: "450.02, no build id", or "450.02, build 1a2b3c4d". */
export function buildText(s: Snapshot): string {
  const fb = s.identity?.fb;
  const fbs = s.identity?.fbs;
  const build = typeof fb === 'number' ? fb.toFixed(2) : 'unknown build';
  return `${build}, ${typeof fbs === 'string' && fbs.length > 0 ? `build ${fbs.slice(0, 8)}` : 'no build id'}`;
}

/**
 * Why the session is read only, in one plain sentence, from the classification's own reason (the strip says it too,
 * status.ts). Never the generic "not approved" when the reason is something else (owner's bench, 2026-11-09: a board
 * left on RTS/CTS flow control read "This firmware is not approved for control").
 */
export function readOnlyWhy(s: Snapshot): string {
  const c = s.classification;
  const ex = s.live.ex;
  switch (c?.reason) {
    case 'flowControl':
      return ex === undefined
        ? 'Run couldn’t read its flow control setting (ex).'
        : `It’s set to ${ex === 2 ? 'hardware flow control (RTS/CTS, ex = 2)' : `flow control ex = ${ex}`}, which Run hasn’t verified.`;
    case 'stock-449':
      return `It runs stock TinyG firmware (${buildText(s)}), which Run only reads.`;
    case 'g2core-read-only':
      return 'Run reads g2core boards but doesn’t control them yet.';
    case 'g2core-unknown-build':
      return `Run doesn’t know this g2core build (${buildText(s)}).`;
    case 'probeFailed':
      return 'Run couldn’t read the board’s identity.';
    case 'conflict':
      return 'Run couldn’t tell which firmware this board runs.';
    default:
      return `Its firmware build isn’t on Run’s approved list (${buildText(s)}).`;
  }
}
