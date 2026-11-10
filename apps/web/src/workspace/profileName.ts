/**
 * The name of the stock profile a machine was made from ("X-Carve"), for the bed's words (owner, 2026-11-09: the bed
 * comes "From the X-Carve profile" until someone enters its numbers). Falls back to the machine's own name.
 */
import { machineStore } from './library.ts';
import { CATALOGUE } from './machineDrawings.ts';

export function profileName(machine: { readonly id: string; readonly name: string } | null): string | null {
  if (machine === null) return null;
  const m = machineStore.value.value.find((x) => x.id === machine.id);
  return CATALOGUE.find((t) => t.id === m?.templateId)?.name ?? machine.name;
}
