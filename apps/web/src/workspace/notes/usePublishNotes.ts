/**
 * A view's notes, kept in the notes registry while the view is mounted (notes.ts): published whenever they change,
 * cleared when the view goes away.
 */
import { useEffect } from 'preact/hooks';
import { publishNotes, type Note } from './notes.ts';

export function usePublishNotes(source: string, notes: readonly Note[]): void {
  const key = JSON.stringify(notes);
  useEffect(() => {
    publishNotes(source, notes);
  }, [source, key]);
  useEffect(() => () => publishNotes(source, []), [source]);
}
