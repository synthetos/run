import type { Project } from '@synthetos/library';
/** Both project and nested file references follow a copied project, while file and job ids stay stable. */
export function copyProject(project: Project, id: string, name: string): Project {
  return { ...project, id, name, jobs: project.jobs.map(job => ({ ...job, projectId: id,
    file: job.file === null ? null : { ...job.file, projectId: id },
  })) };
}
