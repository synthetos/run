import type { Project } from '@synthetos/library';
import { canonical } from './cloudCache.ts';

export const downloadKey = (subject: string, id: string): string => `download/${encodeURIComponent(subject)}/${id}`;
/** Metadata-only availability check: listing never reads file bytes. */
export const fileSignature = (project: Project): string => canonical([...project.files, ...project.images].map(f => ({ id: f.id, hash: f.hash, size: f.size })));
