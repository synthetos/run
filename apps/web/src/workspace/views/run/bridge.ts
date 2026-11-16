import { type ComponentChild } from 'preact';
import { useEffect } from 'preact/hooks';
import { type PreviewParts } from '../../../preview/PreviewPanel.ts';
import { currentFile, currentPreview, pendingOpen, reopenActiveJob } from '../../fileBridge.ts';


/**
 * Publishes the open file for a report's excerpt and its path for the Setup view's scene
 * (workspace/fileBridge.ts), loads the file the job opener resolved, and reopens the active job's file
 * once after a reload. Renders nothing.
 */
export function RunBridge({ parts }: { readonly parts: PreviewParts }): ComponentChild {
  const { state, actions } = parts;
  const result = state.status === 'ready' ? state.result : null;
  useEffect(() => {
    currentFile.value = result === null || state.fileName === null ? null : { name: state.fileName, bytes: result.bytes, preview: result, estimate: parts.estimate };
    currentPreview.value = result === null || state.fileName === null ? null : { name: state.fileName, segments: result.segments, bounds: result.summary.bounds };
  }, [result, state.fileName]);
  const pending = pendingOpen.value;
  const onFile = actions.onFile;
  useEffect(() => {
    if (pending === null || !state.ready || onFile === undefined) return;
    pendingOpen.value = null;
    onFile(pending.file);
  }, [pending, state.ready, onFile]);
  useEffect(() => {
    if (!state.ready || onFile === undefined) return;
    void reopenActiveJob();
  }, [state.ready, onFile === undefined]);
  return null;
}
