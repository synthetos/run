/**
 * Step 4's rule (spec §6.3 step 2, boards): a step started on board A refuses to finish on board B with one line.
 * Pure. The homing choice itself is recorded on the setup record (R3); the board is never written.
 */
import type { MachineProfile } from '@synthetos/library';

export function boardMismatch(connectedId: string | null, machine: MachineProfile | null): string | null {
  const bound = machine?.boardId ?? null;
  if (connectedId === null || machine === null || bound === null || bound === connectedId) return null;
  return `This is board ${connectedId}, not the board ${machine.name} was set up with (${bound}). Connect that board to home it here.`;
}
