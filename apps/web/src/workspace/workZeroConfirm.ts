/**
 * The Set work zero confirmation (C16; plain wording, owner 2026-11-09): one question for whichever axes are set,
 * "Set X, Y and Z zero at the tool's current position? …". In Advanced the machine position of each axis and the
 * offset it becomes are listed under it (the numbers C16 used to carry); Simple leaves them out.
 */
import { h, type ComponentChild } from 'preact';
import { c16 } from '@synthetos/safety';
import { ConfirmCard } from './ui.ts';
import { axesText } from './motion.ts';
import type { MotionAxis } from '../machine-worker/rpc.ts';

const mm = (n: number): string => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(3)} mm`;

export interface WorkZeroConfirmProps {
  readonly axes: readonly MotionAxis[];
  readonly system: string;
  /** Each axis's machine position now, or null when not reported. */
  readonly machine: (axis: MotionAxis) => number | null;
  readonly advanced: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function WorkZeroConfirm(p: WorkZeroConfirmProps): ComponentChild {
  const details = p.advanced
    ? h(
        'ul',
        { class: 'confirm-details', 'data-confirm': 'work-zero-details' },
        p.axes.map((a) => {
          const at = p.machine(a);
          return h('li', { key: a }, at === null ? `${a.toUpperCase()}: machine position not reported` : `${a.toUpperCase()}: machine ${mm(at)}; new ${p.system} offset ${mm(at)}`);
        }),
      )
    : null;
  return h(ConfirmCard, { text: c16({ wcs: p.system, axes: axesText(p.axes) }), confirm: 'Set work zero', safety: 'C16', onCancel: p.onCancel, onConfirm: p.onConfirm }, details);
}
