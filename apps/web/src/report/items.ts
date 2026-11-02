/**
 * The collected items of a report, each with its own checkbox, preview and
 * default (REPORT_A_PROBLEM §4). Pure: the dialog renders these, the zip
 * and the issue body are built from the ones the user leaves ticked.
 */
import type { WorkerStatus } from '../machine-worker/rpc.ts';
import { boardText, environmentText, eventText, gcodeComments, gcodeExcerpt, latin1Text, settingsJson, transcriptExcerpt, type EnvironmentInput, type GcodeExcerpt, type ReportEvent } from './collect.ts';
import type { ComposedItem } from './compose.ts';
import { redactText } from './redact.ts';

type SessionSnapshot = WorkerStatus['session'];

export type ItemId = 'environment' | 'board' | 'event' | 'transcript' | 'settings' | 'gcode';

/** G-code: the excerpt is the default; the whole file only after the consent step, asked every time. */
export type GcodeScope = 'excerpt' | 'whole';

export const GCODE_CONSENT = Object.freeze({
  question: 'Upload the whole G-code file to this issue? Issues are public: anyone can read and download it.',
  whole: 'Upload the whole file',
  excerpt: 'Only 25 lines around the problem',
});

/** The scope a report starts with. Never remembered between reports. */
export const DEFAULT_GCODE_SCOPE: GcodeScope = 'excerpt';

export interface ReportItem {
  readonly id: ItemId;
  readonly title: string;
  /** One line: what it is and how it is redacted. */
  readonly description: string;
  /** False: shown greyed with `missing`, never included. */
  readonly available: boolean;
  readonly missing: string;
  /** Ticked when the dialog opens. */
  readonly defaultOn: boolean;
  /** The redacted text exactly as posted. */
  readonly text: string;
  readonly fence: string;
  readonly note?: string;
  /** The file it becomes in the report files. */
  readonly file: { readonly name: string; readonly data: string | Uint8Array } | null;
}

export interface ItemsInput {
  readonly environment: EnvironmentInput;
  readonly snapshot: SessionSnapshot | null;
  readonly event: ReportEvent | null;
  /** The worker's wire transcript (JSONL), or null when there is none. */
  readonly transcript: string | null;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly file: { readonly name: string; readonly bytes: Uint8Array } | null;
  readonly line: number | null;
  readonly gcodeScope: GcodeScope;
}

export interface GcodeFacts {
  readonly name: string;
  readonly excerpt: GcodeExcerpt;
  readonly comments: readonly string[];
  readonly scope: GcodeScope;
}

/** The G-code facts the dialog shows before posting: the file name and the comments in what would be posted. */
export function gcodeFacts(file: ItemsInput['file'], line: number | null, scope: GcodeScope, ids: readonly (string | undefined)[] = []): GcodeFacts | null {
  if (file === null) return null;
  const text = latin1Text(file.bytes);
  const excerpt = gcodeExcerpt(text, line);
  const posted = scope === 'whole' ? text : excerpt.text;
  return { name: redactText(file.name, ids), excerpt: { ...excerpt, text: redactText(excerpt.text, ids) }, comments: gcodeComments(posted).map((c) => redactText(c, ids)), scope };
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'file.nc';
}

export function reportItems(input: ItemsInput): readonly ReportItem[] {
  const ids = [input.snapshot?.identity?.id];
  const env = environmentText(input.environment);
  const board = boardText(input.snapshot);
  const transcript = input.transcript === null ? null : transcriptExcerpt(input.transcript, ids);
  const settings = settingsJson(input.settings, ids);
  const gcode = gcodeFacts(input.file, input.line, input.gcodeScope, ids);
  // The issue body always carries the excerpt; the whole file, when agreed to, goes in the report files.
  const gcodeText = gcode === null ? '' : gcode.excerpt.text;
  const event = input.event === null ? null : eventText(input.event, ids);
  return [
    {
      id: 'environment',
      title: 'Environment',
      description: 'run version and commit, build channel, browser and OS family. No full user-agent string, no address.',
      available: true,
      missing: '',
      defaultOn: true,
      text: env,
      fence: 'text',
      file: { name: 'environment.txt', data: `${env}\n` },
    },
    {
      id: 'board',
      title: 'Board facts',
      description: 'Firmware build and version, hardware, dialect and approval. The board id becomes 0X0000-XXX.',
      available: board !== null,
      missing: 'No board has been identified on this page.',
      defaultOn: board !== null,
      text: board ?? '',
      fence: 'text',
      file: board === null ? null : { name: 'board.txt', data: `${board}\n` },
    },
    {
      id: 'event',
      title: 'What happened on the machine',
      description: 'The code and message of the notice you reported from, the state at the time and the line being executed.',
      available: event !== null,
      missing: 'Start a report from a notice to include it.',
      defaultOn: event !== null,
      text: event ?? '',
      fence: 'text',
      file: event === null ? null : { name: 'event.txt', data: `${event}\n` },
    },
    {
      id: 'transcript',
      title: 'Recent transcript',
      description: `The last ${transcript === null ? 200 : Math.min(200, transcript.lines)} lines run sent and received. The board id becomes 0X0000-XXX.`,
      available: transcript !== null && transcript.lines > 0,
      missing: 'There is no transcript: no board has been connected on this page.',
      defaultOn: transcript !== null && transcript.lines > 0,
      text: transcript?.text ?? '',
      fence: 'text',
      file: transcript === null || transcript.lines === 0 ? null : { name: 'transcript.txt', data: `${transcript.text}\n` },
    },
    {
      id: 'settings',
      title: 'Settings',
      description: 'The settings already read from the board, in the backup format. Firmware defaults are not known to run yet, so the whole set is included. The id becomes 0X0000-XXX.',
      available: settings !== null,
      missing: 'No settings have been read from a board on this page.',
      defaultOn: false,
      text: settings ?? '',
      fence: 'json',
      file: settings === null ? null : { name: 'settings.json', data: `${settings}\n` },
    },
    {
      id: 'gcode',
      title: 'G-code',
      description:
        gcode === null
          ? 'The file open in the Run view.'
          : input.gcodeScope === 'whole'
            ? `The whole file, ${gcode.excerpt.total.toLocaleString('en-US')} lines.`
            : `Lines ${gcode.excerpt.from} to ${gcode.excerpt.to} of ${gcode.excerpt.total.toLocaleString('en-US')}${gcode.excerpt.line === null ? '' : `, around line ${gcode.excerpt.line}`}.`,
      available: gcode !== null,
      missing: 'No G-code file is open in the Run view.',
      defaultOn: gcode !== null,
      text: gcodeText,
      fence: 'gcode',
      ...(gcode === null ? {} : { note: input.gcodeScope === 'whole' ? `File \`${gcode.name}\`, lines ${gcode.excerpt.from} to ${gcode.excerpt.to} below; the whole file is in the report files.` : `File \`${gcode.name}\`, lines ${gcode.excerpt.from} to ${gcode.excerpt.to}${gcode.excerpt.line === null ? '' : ` (line ${gcode.excerpt.line} marked with >)`}.` }),
      file:
        gcode === null || input.file === null
          ? null
          : input.gcodeScope === 'whole'
            ? { name: safeFileName(gcode.name), data: redactText(latin1Text(input.file.bytes), ids) }
            : { name: `${safeFileName(gcode.name).replace(/\.[^.]+$/, '')}-lines-${gcode.excerpt.from}-${gcode.excerpt.to}.txt`, data: `${gcode.excerpt.text}\n` },
    },
  ];
}

/** The items as the issue body and the Markdown take them: ticked and available only, in order. */
export function composedItems(items: readonly ReportItem[], included: Readonly<Partial<Record<ItemId, boolean>>>): readonly ComposedItem[] {
  return items.filter((i) => i.available && included[i.id] === true).map((i) => ({ title: i.title, text: i.text, fence: i.fence, ...(i.note === undefined ? {} : { note: i.note }) }));
}

/** Which items start ticked. */
export function defaultIncluded(items: readonly ReportItem[]): Partial<Record<ItemId, boolean>> {
  const out: Partial<Record<ItemId, boolean>> = {};
  for (const i of items) out[i.id] = i.available && i.defaultOn;
  return out;
}
