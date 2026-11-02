/**
 * The "Report a problem" dialog (REPORT_A_PROBLEM, Phase A).
 *
 * 1. Triage: the user picks what kind of problem it is, which picks where it
 *    goes (§3): run issues, the firmware's issues (TinyG or g2core), or the
 *    forum for questions and hardware.
 * 2. Write it up and check what is included: the user's own words, then
 *    every collected item with its own checkbox and preview, redacted before
 *    the preview (§4). The G-code excerpt is the default; the whole file
 *    needs the consent step, asked every time.
 * 3. File it: a pre-filled issue link opened in a new tab with `noopener`,
 *    "Download report files" (a zip), and "Copy report" (§5). For the forum,
 *    the link opens the new-discussion form and the report goes on the
 *    clipboard.
 *
 * Safety (§1): the dialog only reads what run already holds. It sends
 * nothing to the board, never takes the connection, and never gets in the
 * way of Pause or Stop job. It is not modal: it covers the views only, below
 * the machine strip, so Pause and Stop job stay visible and clickable, and it
 * never handles Escape (Escape pauses, from anywhere).
 */
import { h, type ComponentChild } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type BuildInfo, shortSha } from '../build-info/buildInfo.ts';
import { downloadTranscript } from '../live/transcriptDownload.ts';
import { Icon } from '../workspace/icons.ts';
import { currentFile } from '../workspace/fileBridge.ts';
import type { WorkspaceModel } from '../workspace/model.ts';
import { copyText } from './clipboard.ts';
import { issueLink, reportMarkdown, type ReportSummary } from './compose.ts';
import { composedItems, DEFAULT_GCODE_SCOPE, defaultIncluded, GCODE_CONSENT, gcodeFacts, reportItems, type GcodeScope, type ItemId, type ReportItem } from './items.ts';
import { closeReport, reportRequest, type ReportKind, type ReportRequest } from './state.ts';
import { firmwareTarget, forumUrl, REPORT_TARGETS, type ReportTargetId } from './targets.ts';
import { makeZip } from './zip.ts';

export interface ReportDialogProps {
  readonly build: BuildInfo;
  readonly model: WorkspaceModel | null;
  /** The view the report was started from (for the environment item). */
  readonly view: string;
}

interface KindOption {
  readonly id: ReportKind;
  readonly title: string;
  readonly detail: string;
}

const KINDS: readonly KindOption[] = [
  { id: 'run', title: 'run isn’t working right', detail: 'Something in this app: a view, the preview, a check, the connection flow.' },
  { id: 'firmware', title: 'The firmware did something wrong', detail: 'The controller answered, moved or stopped in a way it should not have.' },
  { id: 'question', title: 'I have a question, or I’m not sure', detail: 'How to do something, or whether something is a problem at all.' },
  { id: 'hardware', title: 'A board hardware fault', detail: 'A driver, input or output on the board itself. Symptoms only.' },
];

function targetFor(kind: ReportKind, firmware: 'tinyg' | 'g2core'): ReportTargetId {
  if (kind === 'run') return 'run';
  if (kind === 'firmware') return firmware;
  return 'forum';
}

function destinationText(id: ReportTargetId): string {
  const t = REPORT_TARGETS[id];
  return t.kind === 'issues' ? `Opens a new issue on ${t.label} (GitHub, public)` : 'Opens a new discussion on the Synthetos forum';
}

function suggestedTitle(request: ReportRequest, fileName: string | null): string {
  if (request.event !== undefined) return `${request.event.code}: ${request.event.message.split(' (')[0] ?? ''}`.slice(0, 120);
  if (request.line !== undefined) return `Problem with line ${request.line}${fileName === null ? '' : ` of ${fileName}`}`;
  return '';
}

function reportFileName(now: Date): string {
  return `run-report-${now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')}.zip`;
}

/** The consent step for the whole G-code file. The excerpt button is the default and has the focus. */
function ConsentDialog({ onWhole, onExcerpt }: { readonly onWhole: () => void; readonly onExcerpt: () => void }): ComponentChild {
  const excerpt = useRef<HTMLButtonElement>(null);
  useEffect(() => excerpt.current?.focus(), []);
  return h(
    'div',
    { class: 'consent-wrap', role: 'presentation' },
    h(
      'div',
      { class: 'consent', role: 'alertdialog', 'aria-labelledby': 'consent-question', 'data-report': 'consent' },
      h('span', { class: 'consent-icon', 'aria-hidden': 'true' }, Icon('upload', 20)),
      h('p', { id: 'consent-question' }, GCODE_CONSENT.question),
      h(
        'div',
        { class: 'consent-actions' },
        h('button', { type: 'button', 'data-action': 'consent-whole', onClick: onWhole }, GCODE_CONSENT.whole),
        h('button', { type: 'button', class: 'primary', ref: excerpt, 'data-action': 'consent-excerpt', onClick: onExcerpt }, GCODE_CONSENT.excerpt),
      ),
    ),
  );
}

function ItemRow({ item, on, onToggle, children }: { readonly item: ReportItem; readonly on: boolean; readonly onToggle: (v: boolean) => void; readonly children?: ComponentChild }): ComponentChild {
  const id = `report-item-${item.id}`;
  return h(
    'li',
    { class: `report-item${item.available ? '' : ' is-missing'}${on && item.available ? ' is-on' : ''}`, 'data-report-item': item.id },
    h(
      'div',
      { class: 'report-item-head' },
      h('input', { type: 'checkbox', id, checked: on && item.available, disabled: !item.available, onChange: (e: Event) => onToggle((e.currentTarget as HTMLInputElement).checked) }),
      h('label', { for: id }, h('strong', null, item.title), h('small', null, item.available ? item.description : item.missing)),
    ),
    children,
    item.available
      ? h(
          'details',
          { class: 'report-preview' },
          h('summary', null, on ? 'Preview: exactly what is posted' : 'Preview (not included)'),
          h('pre', { 'data-report-preview': item.id }, item.text),
        )
      : null,
  );
}

export function ReportDialog({ build, model, view }: ReportDialogProps): ComponentChild {
  const request = reportRequest.value;
  if (request === null) return null;
  // Remounted per request (key), so nothing (the G-code scope above all) carries over between reports.
  return h(ReportBody, { key: String(request.seq), build, model, view, request });
}

function ReportBody({ build, model, view, request }: ReportDialogProps & { readonly request: ReportRequest }): ComponentChild {
  const live = model?.live.value ?? null;
  const snapshot = live?.message?.snapshot ?? null;
  const connectedSnap = snapshot !== null && snapshot.base !== 'NOT_CONNECTED' ? snapshot : null;
  const dialect = connectedSnap?.classification?.dialectId ?? null;
  const file = currentFile.value;
  const [step, setStep] = useState<'triage' | 'write'>(request.kind === undefined ? 'triage' : 'write');
  const [kind, setKind] = useState<ReportKind | null>(request.kind ?? null);
  const [firmware, setFirmware] = useState<'tinyg' | 'g2core'>(firmwareTarget(dialect) ?? 'tinyg');
  const [summary, setSummary] = useState<ReportSummary>({ title: suggestedTitle(request, file?.name ?? null), happened: '', steps: '', expected: '' });
  const [scope, setScope] = useState<GcodeScope>(DEFAULT_GCODE_SCOPE);
  const [asking, setAsking] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const first = useRef<HTMLElement>(null);

  // The transcript the worker already keeps in memory (never a board read).
  useEffect(() => {
    let live = true;
    void model?.actions.value
      ?.transcriptText()
      .then((t) => {
        if (live) setTranscript(t);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [model]);
  useEffect(() => first.current?.focus(), [step]);

  const items = useMemo(
    () =>
      reportItems({
        environment: { version: build.version, sha: build.sha, channel: typeof document !== 'undefined' && document.documentElement.dataset['channel'] === 'bench' ? 'bench' : 'release', userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent, view, snapshot: connectedSnap },
        snapshot: connectedSnap,
        event: request.event ?? null,
        transcript,
        settings: live?.readout.settings ?? {},
        file,
        line: request.line ?? null,
        gcodeScope: scope,
      }),
    [build, view, connectedSnap, request, transcript, live?.readout.settings, file, scope],
  );
  // Only the user's own choices are kept; an untouched item follows its default, so an item that becomes
  // available after opening (the transcript arrives) starts with its default.
  const [chosen, setChosen] = useState<Partial<Record<ItemId, boolean>>>({});
  const defaults = defaultIncluded(items);
  const included: Partial<Record<ItemId, boolean>> = { ...defaults, ...chosen };

  const target = kind === null ? null : targetFor(kind, firmware);
  const version = `v${build.version} (${shortSha(build.sha)})`;
  const composeInput = { summary, items: composedItems(items, included), version };
  const ready = summary.title.trim() !== '' && summary.happened.trim() !== '';
  const link = target !== null && REPORT_TARGETS[target].kind === 'issues' && ready ? issueLink(target, composeInput) : null;
  const facts = gcodeFacts(file, request.line ?? null, scope, [connectedSnap?.identity?.id]);

  const field = (key: keyof ReportSummary, label: string, hint: string, rows: number, required: boolean): ComponentChild =>
    h(
      'div',
      { class: 'field' },
      h('label', { for: `report-${key}` }, label, required ? h('span', { class: 'req' }, ' required') : null),
      rows === 1
        ? h('input', { id: `report-${key}`, type: 'text', value: summary[key], placeholder: hint, maxLength: 200, ref: key === 'title' ? first : undefined, onInput: (e: Event) => setSummary({ ...summary, [key]: (e.currentTarget as HTMLInputElement).value }) })
        : h('textarea', { id: `report-${key}`, rows, value: summary[key], placeholder: hint, onInput: (e: Event) => setSummary({ ...summary, [key]: (e.currentTarget as HTMLTextAreaElement).value }) }),
    );

  const download = (): void => {
    const md = reportMarkdown(composeInput);
    const entries = [{ name: 'report.md', data: `${md}\n` }, ...items.filter((i) => i.available && included[i.id] === true && i.file !== null).map((i) => i.file as { name: string; data: string | Uint8Array })];
    const now = new Date();
    downloadTranscript(document, makeZip(entries), reportFileName(now), 'application/zip');
    setStatus(`Saved ${reportFileName(now)}: ${entries.length} files. Drag them into the issue or post.`);
  };
  const copy = (): void => {
    setStatus(copyText(document, reportMarkdown(composeInput)) ? 'Report copied as Markdown.' : 'The browser refused to copy. Download the report files instead.');
  };

  const triage = h(
    'div',
    { class: 'report-triage' },
    h('p', { class: 'report-lead' }, 'Pick what fits best. It decides where the report goes; nothing is sent until you open the link.'),
    h(
      'div',
      { class: 'triage-grid', role: 'radiogroup', 'aria-label': 'Kind of problem' },
      KINDS.map((k, i) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            key: k.id,
            class: 'triage-card',
            'aria-checked': kind === k.id ? 'true' : 'false',
            'data-report-kind': k.id,
            ref: i === 0 ? first : undefined,
            onClick: () => setKind(k.id),
          },
          h('strong', null, k.title),
          h('span', null, k.detail),
          h('small', { class: 'triage-dest' }, k.id === 'firmware' ? (firmwareTarget(dialect) === null ? 'Opens a new issue on synthetos/TinyG or synthetos/g2core' : destinationText(firmwareTarget(dialect) as ReportTargetId)) : k.id === 'hardware' ? 'The forum: hardware repositories are private' : destinationText(targetFor(k.id, firmware))),
        ),
      ),
    ),
    kind === 'firmware'
      ? h(
          'div',
          { class: 'firmware-pick', role: 'radiogroup', 'aria-label': 'Firmware' },
          h('span', null, dialect === null ? 'Which firmware?' : `This board runs ${dialect}.`),
          (['tinyg', 'g2core'] as const).map((f) =>
            h('label', { key: f, class: 'pick' }, h('input', { type: 'radio', name: 'report-firmware', value: f, checked: firmware === f, onChange: () => setFirmware(f) }), f === 'tinyg' ? 'TinyG' : 'g2core'),
          ),
        )
      : null,
  );

  const write = h(
    'div',
    { class: 'report-write' },
    h(
      'div',
      { class: 'report-words' },
      h('h3', { class: 'tan-label' }, 'In your words'),
      field('title', 'Title', 'One line: what went wrong', 1, true),
      field('happened', 'What happened', 'What you saw, and when', 4, true),
      field('steps', 'Steps to reproduce', '1. Open …  2. Click …', 3, false),
      field('expected', 'What you expected', 'What should have happened instead', 2, false),
    ),
    h(
      'div',
      { class: 'report-collected' },
      h('h3', { class: 'tan-label' }, 'What’s included'),
      h('p', { class: 'fine' }, 'Issues are public. Each item is shown exactly as it would be posted; untick anything you would rather keep.'),
      h(
        'ul',
        { class: 'report-items' },
        items.map((item) =>
          h(
            ItemRow,
            { key: item.id, item, on: included[item.id] === true, onToggle: (v: boolean) => setChosen({ ...chosen, [item.id]: v }) },
            item.id === 'gcode' && facts !== null
              ? h(
                  'div',
                  { class: 'gcode-facts' },
                  h('p', { class: 'gcode-name' }, 'File name: ', h('code', { 'data-report': 'file-name' }, facts.name)),
                  facts.comments.length === 0
                    ? h('p', { class: 'fine' }, 'No comments in what would be posted.')
                    : h('div', { class: 'gcode-comments', 'data-report': 'comments' }, h('p', { class: 'fine' }, 'Comments in what would be posted (they can name customers or parts):'), h('ul', null, facts.comments.slice(0, 12).map((c) => h('li', { key: c }, c)))),
                  h(
                    'div',
                    { class: 'scope-pick', role: 'radiogroup', 'aria-label': 'How much G-code' },
                    h('label', { class: 'pick' }, h('input', { type: 'radio', name: 'report-scope', value: 'excerpt', checked: scope === 'excerpt', 'data-report': 'scope-excerpt', onChange: () => setScope('excerpt') }), '25 lines around the problem'),
                    h('label', { class: 'pick' }, h('input', { type: 'radio', name: 'report-scope', value: 'whole', checked: scope === 'whole', 'data-report': 'scope-whole', onChange: () => setAsking(true) }), 'The whole file'),
                  ),
                )
              : null,
          ),
        ),
      ),
    ),
  );

  const isForum = target !== null && REPORT_TARGETS[target].kind === 'forum';
  const actions =
    step === 'triage'
      ? h(
          'div',
          { class: 'dialog-actions' },
          h('button', { type: 'button', 'data-action': 'report-cancel', onClick: closeReport }, 'Cancel'),
          h('button', { type: 'button', class: 'primary', disabled: kind === null, 'data-action': 'report-next', onClick: () => setStep('write') }, 'Next: write it up'),
        )
      : h(
          'div',
          { class: 'report-actions' },
          h('button', { type: 'button', class: 'quiet', 'data-action': 'report-back', onClick: () => setStep('triage') }, 'Back'),
          h('span', { class: 'report-status', role: 'status', 'data-report': 'status' }, status ?? (ready ? (link?.truncated === true ? 'The diagnostics were cut to fit the link; the report files have everything.' : '') : 'Add a title and what happened to file it.')),
          h('button', { type: 'button', disabled: !ready, 'data-action': 'report-copy', onClick: copy }, Icon('lines', 15), 'Copy report'),
          h('button', { type: 'button', disabled: !ready, 'data-action': 'report-download', onClick: download }, Icon('download', 15), 'Download report files'),
          !ready || target === null
            ? h('button', { type: 'button', class: 'primary', disabled: true, 'data-action': 'report-open' }, isForum ? 'Open the forum' : 'Open the issue')
            : isForum
              ? h(
                  'a',
                  {
                    class: 'button primary',
                    href: forumUrl(),
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    'data-report': 'open',
                    onClick: () => setStatus(copyText(document, reportMarkdown(composeInput)) ? 'Report copied. Paste it into the new forum post.' : 'Opened the forum. Copy the report with “Copy report”.'),
                  },
                  Icon('external', 15),
                  'Open the forum and copy',
                )
              : h('a', { class: 'button primary', href: link?.url ?? '', target: '_blank', rel: 'noopener noreferrer', 'data-report': 'open', 'data-truncated': link?.truncated === true ? 'true' : 'false' }, Icon('external', 15), `Open the issue on ${REPORT_TARGETS[target].label}`),
        );

  return h(
    'div',
    { class: 'report-wrap', role: 'presentation', 'data-region': 'report' },
    h(
      'div',
      { class: `dialog report-dialog${step === 'write' ? ' is-write' : ''}`, role: 'dialog', 'aria-labelledby': 'report-heading', 'data-report-step': step },
      h(
        'div',
        { class: 'dialog-head' },
        h('div', { class: 'report-head' }, h('span', { class: 'report-mark', 'aria-hidden': 'true' }, Icon('flag', 18)), h('div', null, h('h2', { id: 'report-heading' }, 'Report a problem'), h('p', { class: 'report-sub' }, step === 'triage' ? 'Step 1 of 2 · where it goes' : `Step 2 of 2 · ${target === null ? '' : destinationText(target)}`))),
        h('button', { type: 'button', class: 'icon-button quiet', 'aria-label': 'Close the report', 'data-action': 'report-close', onClick: closeReport }, '×'),
      ),
      h('p', { class: 'report-safe' }, 'Reporting sends nothing to the machine. Pause and Stop job work as always.'),
      step === 'triage' ? triage : write,
      actions,
      asking
        ? h(ConsentDialog, {
            onWhole: () => {
              setAsking(false);
              setScope('whole');
            },
            onExcerpt: () => {
              setAsking(false);
              setScope('excerpt');
            },
          })
        : null,
    ),
  );
}
