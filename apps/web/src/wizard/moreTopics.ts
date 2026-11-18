/**
 * The "More to set up" list on the wizard's last step (spec §6.3 step 7, owner 2026-11-17): the topics the wizard
 * did not cover, each a collapsed row that expands to two or three lines and a link to the place in Run where it is
 * done. Data only, one file; each row is the seed of a future help article (docs/design/HELP_SYSTEM.md). Grows as
 * TinyG firmware capabilities and Run features are reviewed.
 */
import type { BoardTab } from '../workspace/boardNavigation.ts';

export interface Topic {
  /** Stable slug; the future help article's id. */
  readonly id: string;
  readonly title: string;
  /** Two or three short sentences. */
  readonly lines: readonly string[];
  /** Where in Run it is done: an AppShell view name, with the Board tab when it is one. */
  readonly go: { readonly view: string; readonly tab?: BoardTab; readonly label: string };
}

export const MORE_TOPICS: readonly Topic[] = Object.freeze([
  {
    id: 'materials-feeds',
    title: 'Materials and feeds',
    lines: ['Every material starts with placeholder numbers.', 'Replace them with what your machine cuts well.', 'Analyze compares a file against them before you run it.'],
    go: { view: 'materials', label: 'Open Materials' },
  },
  {
    id: 'work-zero-probing',
    title: 'Work zero and probing',
    lines: ['The Job page sets work zero from the stock corner you choose.', 'A Z probe sets the height from a touch plate.'],
    go: { view: 'job', label: 'Open the Job page' },
  },
  {
    id: 'feed-override',
    title: 'Feed override',
    lines: ['While a job runs, the feed can be set from 10 to 150 percent.', 'The override applies to the next moves, not the one in flight.'],
    go: { view: 'job', label: 'Open the Job page' },
  },
  {
    id: 'firmware-backups',
    title: 'Firmware backups',
    lines: ['Board keeps a backup of the settings before any update.', 'A firmware image backup can be put back from the same place.'],
    go: { view: 'board', tab: 'backups', label: 'Open Board backups' },
  },
  {
    id: 'projects-zip',
    title: 'Projects and zip export',
    lines: ['A project keeps files, photos, notes and the setup together.', 'Export one as a zip to share it or move it.'],
    go: { view: 'projects', label: 'Open Projects' },
  },
  {
    id: 'report-problem',
    title: 'Reporting a problem',
    lines: ['Run gathers what it knows about the board and the job.', 'You see every piece before anything is posted.'],
    go: { view: 'safety', label: 'Open Safety' },
  },
]);
