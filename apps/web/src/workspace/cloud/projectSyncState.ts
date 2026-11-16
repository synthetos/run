import { signal } from '@preact/signals';

/** Listing account records never downloads bytes. Opening a project explicitly requests them. */
export const accountProjects = signal<readonly string[]>([]);
export const projectDownload = { open: (_id: string): Promise<void> => Promise.resolve() };
