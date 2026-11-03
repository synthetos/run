/**
 * The preview sheet (ROADMAP TB-03, RUN_PLAN §7.6): W13 pinned, file and
 * dialect choice, preview mode (auto, lite, full 3D), progress with Cancel,
 * the rapids toggle, the line scrubber, the summary, the drawing and the
 * G-code list with a safety verdict per line.
 *
 * This is a pure view of a state: the container (PreviewPanel) owns the state
 * and the worker. It is prerendered in its idle state with every control
 * disabled until the page's script is running.
 *
 * There is no Play, Simulate or Animate control (SAFETY H15, T-S41): the
 * scrubber highlights lines and segments and nothing moves.
 */
import { h, type ComponentChild } from 'preact';
import { w13 } from '@synthetos/safety';
import type { Finding } from '@synthetos/gcode';
import type { DialectId } from '@synthetos/protocol';
import type { ViewPreset } from '@synthetos/gcode-view';
import { LITE_THRESHOLD_LINES, PREVIEW_DIALECTS, type PreviewMode, type PreviewProgress, type PreviewResult } from '../gcode-worker/pipeline.ts';

export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PreviewViewState {
  /** False until the page's script is running (and always in the prerendered HTML). */
  readonly ready: boolean;
  readonly dialect: DialectId;
  readonly mode: PreviewMode;
  readonly status: PreviewStatus;
  readonly progress: PreviewProgress | null;
  readonly fileName: string | null;
  readonly error: string | null;
  readonly result: PreviewResult | null;
  readonly showRapids: boolean;
  /** Sent lines highlighted by the scrubber (0 = none). */
  readonly scrub: number;
  /** How the drawing is shown once loaded. */
  readonly drawing: 'webgl' | 'svg';
}

export interface PreviewViewActions {
  readonly onFile?: (file: File) => void;
  readonly onDialect?: (dialect: DialectId) => void;
  readonly onMode?: (mode: PreviewMode) => void;
  readonly onCancel?: () => void;
  readonly onRapids?: (show: boolean) => void;
  readonly onScrub?: (sentLines: number) => void;
  readonly onFit?: () => void;
  /** Turns the 3D drawing to a named view (3D, top, front). */
  readonly onView?: (preset: ViewPreset) => void;
}

export interface PreviewSlots {
  /** The 3D canvas or the 2D SVG drawing. */
  readonly drawing?: ComponentChild;
  /** The virtualised G-code list. */
  readonly list?: ComponentChild;
  /** P1-07: the live position readout. */
  readonly marker?: ComponentChild;
}

export const IDLE_STATE: PreviewViewState = Object.freeze({
  ready: false,
  dialect: 'tinyg-en',
  mode: 'auto',
  status: 'idle',
  progress: null,
  fileName: null,
  error: null,
  result: null,
  showRapids: true,
  scrub: 0,
  drawing: 'webgl',
});

export const DIALECT_LABEL: Readonly<Record<string, string>> = { 'tinyg-en': 'TinyG edge-next (EN)', 'tinyg-440': 'TinyG 440.xx' };
export const MODE_LABEL: Readonly<Record<PreviewMode, string>> = {
  auto: `Auto (lite above ${LITE_THRESHOLD_LINES.toLocaleString('en-US')} lines)`,
  lite: 'Lite: list and summary, no drawing',
  full: 'Full: always draw',
};

export function progressText(p: PreviewProgress | null): string {
  if (p === null) return 'Starting';
  if (p.phase === 'read') return `Reading the file: ${String(Math.round(p.fraction * 100))}%`;
  return { sanitise: 'Checking every line', interpret: 'Interpreting', pack: 'Preparing the preview' }[p.phase];
}

/** An event handler prop only when the action exists, so the prerendered sheet carries none. */
export function on<A, E>(name: string, action: A | undefined, make: (action: A) => (e: E) => void): Record<string, (e: E) => void> {
  return action === undefined ? {} : { [name]: make(action) };
}

const fmt = (n: number): string => (Math.round(n * 1000) / 1000).toString();

export function summary(result: PreviewResult): ComponentChild {
  const s = result.summary;
  const b = s.bounds;
  const sent = result.sourceLines.length;
  return h(
    'dl',
    { class: 'preview-summary', 'data-preview': 'summary' },
    h('dt', null, 'Verdict'),
    h('dd', { 'data-verdict': s.blocked ? 'block' : 'ok' }, s.blocked ? 'Blocked: this file cannot be run as it is' : 'No blocking findings'),
    h('dt', null, 'Findings'),
    h('dd', null, `${String(s.counts.block)} block, ${String(s.counts.warn)} warn, ${String(s.counts.change)} change, ${String(s.counts.info)} info`),
    h('dt', null, 'Lines'),
    h('dd', null, `${result.fileLines.toLocaleString('en-US')} in the file, ${sent.toLocaleString('en-US')} to send`),
    h('dt', null, 'Extent (machine)'),
    h('dd', null, b === null ? 'nothing drawn' : `X ${fmt(b.min[0])} to ${fmt(b.max[0])}, Y ${fmt(b.min[1])} to ${fmt(b.max[1])}, Z ${fmt(b.min[2])} to ${fmt(b.max[2])} mm`),
    h('dt', null, 'Envelope'),
    h('dd', null, 'Unknown until a board is connected: it comes only from the board’s travel settings.'),
    h('dt', null, 'Start'),
    h('dd', null, 'Assumed: machine at 0, 0, 0, G54 with zero offsets, G21 G90 G17. No board was read.'),
    h('dt', null, 'Distance'),
    h('dd', null, `${fmt(s.stats.feedMm)} mm feed, ${fmt(s.stats.rapidMm)} mm rapid, ${String(s.stats.arcs)} arcs`),
  );
}

export function fileLevel(findings: readonly Finding[]): ComponentChild {
  if (findings.length === 0) return null;
  return h(
    'ul',
    { class: 'preview-file-findings', 'data-preview': 'file-findings' },
    findings.map((f) => h('li', { 'data-verdict': f.severity }, h('span', { class: 'verdict-badge' }, f.severity), ' ', f.message)),
  );
}

export function PreviewView({ state, actions = {}, slots = {} }: { readonly state: PreviewViewState; readonly actions?: PreviewViewActions; readonly slots?: PreviewSlots }): ComponentChild {
  const loading = state.status === 'loading';
  const disabled = !state.ready || loading;
  const result = state.status === 'ready' ? state.result : null;
  const sent = result?.sourceLines.length ?? 0;
  const scrubLine = state.scrub > 0 && result !== null ? (result.sourceLines[state.scrub - 1] ?? 0) : 0;
  return h(
    'section',
    { class: 'sheet preview', 'data-region': 'preview', 'aria-labelledby': 'preview-title' },
    h(
      'div',
      { class: 'title-block' },
      h('span', { class: 'label' }, 'Sheet'),
      h('span', { class: 'value' }, 'Preview'),
      h('span', { class: 'label' }, 'File'),
      h('span', { class: 'value', 'data-preview': 'file-name' }, state.fileName ?? 'none'),
    ),
    h('p', { class: 'preview-w13', role: 'note', 'data-safety': 'W13' }, w13()),
    slots.marker ?? null,
    h(
      'div',
      { class: 'sheet-body' },
      h('h2', { id: 'preview-title' }, 'G-code preview'),
      h(
        'div',
        { class: 'preview-controls' },
        h(
          'label',
          null,
          'G-code file ',
          h('input', {
            type: 'file',
            accept: '.nc,.gcode,.ngc,.tap,.txt,.cnc,text/plain',
            disabled,
            'data-preview': 'file',
            ...on('onChange', actions.onFile, (f) => (e: Event) => {
              const file = (e.currentTarget as HTMLInputElement).files?.[0];
              if (file !== undefined) f(file);
            }),
          }),
        ),
        h(
          'label',
          null,
          'Dialect ',
          h(
            'select',
            { value: state.dialect, disabled, ...on('onChange', actions.onDialect, (f) => (e: Event) => { f((e.currentTarget as HTMLSelectElement).value as DialectId); }) },
            PREVIEW_DIALECTS.map((d) => h('option', { value: d }, DIALECT_LABEL[d] ?? d)),
          ),
        ),
        h(
          'label',
          null,
          'Mode ',
          h(
            'select',
            { value: state.mode, disabled, 'data-preview': 'mode', ...on('onChange', actions.onMode, (f) => (e: Event) => { f((e.currentTarget as HTMLSelectElement).value as PreviewMode); }) },
            (['auto', 'lite', 'full'] as const).map((m) => h('option', { value: m }, MODE_LABEL[m])),
          ),
        ),
        h(
          'label',
          null,
          h('input', { type: 'checkbox', checked: state.showRapids, disabled: !state.ready, 'data-preview': 'rapids', ...on('onChange', actions.onRapids, (f) => (e: Event) => { f((e.currentTarget as HTMLInputElement).checked); }) }),
          ' Show rapids',
        ),
      ),
      loading
        ? h(
            'div',
            { class: 'preview-progress', role: 'status', 'data-preview': 'progress' },
            h('span', null, progressText(state.progress)),
            ' ',
            h('button', { type: 'button', class: 'btn', 'data-preview': 'cancel', ...on('onClick', actions.onCancel, (f) => () => { f(); }) }, 'Cancel'),
          )
        : null,
      state.status === 'error' ? h('p', { class: 'preview-error', role: 'alert', 'data-preview': 'error' }, state.error ?? 'The preview failed.') : null,
      state.status === 'idle' ? h('p', { class: 'preview-empty' }, 'Choose a G-code file to check and preview it. The file stays in this browser.') : null,
      result === null
        ? null
        : h(
            'div',
            { class: 'preview-result', 'data-lite': result.lite ? 'true' : 'false' },
            result.lite
              ? h(
                  'p',
                  { class: 'preview-lite', 'data-preview': 'lite' },
                  result.liteBySize
                    ? `Lite mode: this file has more than ${LITE_THRESHOLD_LINES.toLocaleString('en-US')} lines, so it is not drawn. Choose Full to draw it anyway.`
                    : 'Lite mode: the list and summary only, no drawing.',
                )
              : h(
                  'div',
                  { class: 'preview-drawing', 'data-preview': 'drawing', 'data-drawing': state.drawing },
                  slots.drawing ?? null,
                  state.drawing === 'webgl'
                    ? h('button', { type: 'button', class: 'btn', 'data-preview': 'fit', ...on('onClick', actions.onFit, (f) => () => { f(); }) }, 'Fit view')
                    : null,
                ),
            h(
              'div',
              { class: 'preview-scrubber' },
              h(
                'label',
                { for: 'preview-scrub' },
                'Highlight lines up to ',
                h('output', { for: 'preview-scrub', 'data-preview': 'scrub-line' }, state.scrub === 0 ? 'none' : `file line ${String(scrubLine)}`),
              ),
              h('input', {
                id: 'preview-scrub',
                type: 'range',
                min: 0,
                max: sent,
                step: 1,
                value: state.scrub,
                'data-preview': 'scrubber',
                'aria-valuetext': state.scrub === 0 ? 'no lines highlighted' : `highlighting up to file line ${String(scrubLine)}`,
                ...on('onInput', actions.onScrub, (f) => (e: Event) => { f(Number((e.currentTarget as HTMLInputElement).value)); }),
              }),
            ),
            summary(result),
            fileLevel(result.summary.fileLevel),
            slots.list ?? null,
          ),
    ),
  );
}
