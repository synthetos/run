/** Resolve recorded project setup without substituting a newer or deleted record. Page-side planning only. */
import { readStock } from '@synthetos/library';
import type { Project } from './store.ts';
import { withMachine, withSetup, type Job, type JobClock } from '../workspace/jobModel.ts';
import { machineRevision, type MachineProfile, type Material } from '../workspace/library.ts';

export interface SetupRecords {
  readonly machines: readonly MachineProfile[];
  readonly materials: readonly Material[];
}

export function projectSetupForJob(project: Project, job: Job, records: SetupRecords, clock: JobClock): { job: Job; note: string; differs: boolean } {
  const setup = project.setup;
  const parts: string[] = [];
  let next = job;
  if (setup.machine !== null) {
    const machine = records.machines.find(m => m.id === setup.machine?.id && (setup.machine.version === undefined || machineRevision(m) === setup.machine.version));
    parts.push(machine?.name ?? `${setup.machine.name} (recorded version unavailable)`);
    if (machine !== undefined) next = withMachine(next, machine, clock);
  }
  if (setup.stock !== null) {
    const stock = readStock(setup.stockSnapshot);
    parts.unshift(`${setup.stock.name}${stock.ok ? '' : ' (dimensions not recorded)'}`);
    if (stock.ok) next = withSetup(next, { stock: stock.value, stockOutline: null }, clock);
  }
  if (setup.material !== null) {
    const material = records.materials.find(m => m.id === setup.material?.id && (setup.material.version === undefined || m.version === setup.material.version));
    parts.unshift(material?.name ?? `${setup.material.name} (recorded version unavailable)`);
    if (material !== undefined) next = withSetup(next, { stock: { ...next.setup.stock, materialRef: { id: material.id, version: material.version } } }, clock);
  }
  const differs = JSON.stringify([job.machine, job.setup]) !== JSON.stringify([next.machine, next.setup]);
  return { job: differs ? next : job, note: parts.length === 0 ? '' : `From project ${project.name}: ${parts.join(', ')}.`, differs };
}

export function setupDescription(job: Job, records: SetupRecords): string {
  const stock = job.setup.stock;
  const material = records.materials.find(m => m.id === stock.materialRef.id && m.version === stock.materialRef.version);
  return `${material?.name ?? `${stock.materialRef.id} (recorded version unavailable)`}, ${stock.shape} ${stock.thickness} mm thick, ${job.machine?.name ?? 'no machine chosen'}`;
}
