/**
 * The preview container (ROADMAP TB-03): owns the preview state and the
 * `gcode.worker` client, and fills the pure PreviewView with the drawing and
 * the list. Hydrates the idle sheet the build prerendered.
 *
 * Nothing here reaches a machine: the worker has no transport.
 */
import { h, type ComponentChild } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Finding } from '@synthetos/gcode';
import { createGcodePreviewClient, type GcodePreviewClient, type WorkerLike } from '../gcode-worker/client.ts';
import type { PreviewMode, PreviewResult } from '../gcode-worker/pipeline.ts';
import { LineList } from './LineList.ts';
import { Preview3D } from './Preview3D.ts';
import { PreviewSvg } from './PreviewSvg.ts';
import { IDLE_STATE, PreviewView, type PreviewViewState } from './PreviewView.ts';

export interface PreviewPanelProps {
  /** Starts `gcode.worker`; null without Trusted Types (the panel stays disabled). */
  readonly spawn: (() => WorkerLike) | null;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function PreviewPanel({ spawn }: PreviewPanelProps): ComponentChild {
  const [state, setState] = useState<PreviewViewState>(IDLE_STATE);
  const [fitRequest, setFitRequest] = useState(0);
  const client = useRef<GcodePreviewClient | null>(null);
  const lastFile = useRef<File | null>(null);

  useEffect(() => {
    if (spawn === null) return;
    client.current = createGcodePreviewClient(spawn);
    setState((s) => ({ ...s, ready: true }));
    return () => {
      client.current?.dispose();
      client.current = null;
    };
  }, [spawn]);

  const load = useCallback((file: File, dialect: PreviewViewState['dialect'], mode: PreviewMode) => {
    const c = client.current;
    if (c === null) return;
    lastFile.current = file;
    setState((s) => ({ ...s, status: 'loading', progress: null, fileName: file.name, error: null, result: null, scrub: 0, dialect, mode }));
    c.load(file, { dialect, mode }, (progress) => { setState((s) => (s.status === 'loading' ? { ...s, progress } : s)); }).then(
      (result: PreviewResult) => { setState((s) => ({ ...s, status: 'ready', result, progress: null })); },
      (e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState((s) => ({ ...s, status: 'error', error: message(e), progress: null }));
      },
    );
  }, []);

  const fetchFindings = useCallback((from: number, to: number): Promise<readonly Finding[]> => client.current?.findings(from, to) ?? Promise.resolve([]), []);

  const result = state.status === 'ready' ? state.result : null;
  const segments = result?.segments ?? null;
  const highlight = state.scrub - 1;
  const highlightLine = state.scrub > 0 && result !== null ? (result.sourceLines[state.scrub - 1] ?? 0) : 0;
  const listData = useMemo(() => (result === null ? null : { bytes: result.bytes, spans: result.spans, verdicts: result.verdicts }), [result]);

  const drawing =
    segments === null || result === null
      ? undefined
      : state.drawing === 'webgl'
        ? h(Preview3D, {
            segments,
            bounds: result.summary.bounds,
            showRapids: state.showRapids,
            highlight,
            wcsOrigin: result.summary.wcsOrigin,
            envelope: result.summary.envelope,
            fitRequest,
            onUnavailable: () => { setState((s) => ({ ...s, drawing: 'svg' })); },
          })
        : h(PreviewSvg, { segments, showRapids: state.showRapids, highlight, envelope: result.summary.envelope });

  return h(PreviewView, {
    state,
    actions: {
      onFile: (file) => { load(file, state.dialect, state.mode); },
      onDialect: (dialect) => {
        if (lastFile.current !== null) load(lastFile.current, dialect, state.mode);
        else setState((s) => ({ ...s, dialect }));
      },
      onMode: (mode) => {
        if (lastFile.current !== null) load(lastFile.current, state.dialect, mode);
        else setState((s) => ({ ...s, mode }));
      },
      onCancel: () => {
        client.current?.cancel();
        lastFile.current = null;
        setState((s) => ({ ...s, status: 'idle', progress: null, fileName: null, result: null }));
      },
      onRapids: (showRapids) => { setState((s) => ({ ...s, showRapids })); },
      onScrub: (scrub) => { setState((s) => ({ ...s, scrub })); },
      onFit: () => { setFitRequest((n) => n + 1); },
    },
    slots: {
      ...(drawing === undefined ? {} : { drawing }),
      ...(listData === null ? {} : { list: h(LineList, { data: listData, highlightLine, revealLine: highlightLine, fetchFindings }) }),
    },
  });
}
