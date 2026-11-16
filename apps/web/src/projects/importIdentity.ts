import type { Project } from '@synthetos/library';
import { isRecordId } from '../workspace/cloud/recordId.ts';
import { copyProject } from './copyProject.ts';

/** Validate before installation and bind every nested job to its containing project. */
export function importIdentity(project: Project, occupied: ReadonlySet<string>, newId: () => string): Project {
  if (!isRecordId(project.id)) throw new Error('The project id must use 1–64 lowercase letters, digits, dots, underscores or hyphens, starting with a letter or digit.');
  let id = project.id; let name = project.name;
  if (occupied.has(id)) {
    do {
      id = newId();
      if (!isRecordId(id)) throw new Error('A valid new project id could not be created.');
    } while (occupied.has(id));
    name = `${name.slice(0, 244)} (imported)`;
  }
  return copyProject(project, id, name);
}
