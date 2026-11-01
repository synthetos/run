import type { VNode } from 'preact';

/**
 * The empty workspace shell. Phase 0 renders only the layout regions; the
 * safety bar, rail and panels arrive in P0-05 and later tasks. This module
 * has no machine, serial or network code.
 */
export function Shell(): VNode {
  return (
    <div class="shell" data-shell="workspace">
      <header class="shell-bar" data-region="safety-bar" />
      <nav class="shell-rail" data-region="rail" aria-label="Modes" />
      <main class="shell-centre" data-region="centre" />
    </div>
  );
}
