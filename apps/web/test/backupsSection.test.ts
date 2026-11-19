/**
 * One Backups section (Board settings spec §5.8): the heading with Back up settings and one way to bring a file in
 * (Add a backup file…), a zebra list with Why words, the board and the settings count, Compare in plain words, and
 * Restore from the row (absent on a read-only board), which stages pending changes and opens the tab of the first one.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { signal } from '@preact/signals';
import { clearDraft, setDraft } from '../src/workspace/boardFacts.ts';
import { boardTab } from '../src/workspace/boardNavigation.ts';
import type { FirmwareActions, FirmwareHubView, LiveView, WorkspaceModel } from '../src/workspace/model.ts';
import { BackupsSection } from '../src/workspace/views/board/backups.ts';
import { all, byAttr, one, root, text, type El } from './tree.ts';
import { boardView, OWNER_449 } from './boardViews.ts';

type Rows = FirmwareHubView['settings'];
const ROW = (over: Partial<Rows[number]> = {}): Rows[number] => ({ id: 'b1', boardId: 'SIM-EN-0001', dialect: 'tinyg-en', fb: 450.06, fv: 0.97, takenAt: '2026-11-18T10:00:00.000Z', trigger: 'manual', settingsCount: 186, ...over });
const HUB = (settings: Rows, compare: FirmwareHubView['compare'] = null): FirmwareHubView => ({ settings, compare, notice: null, firmware: [], trust: [] }) as unknown as FirmwareHubView;

function model(view: LiveView, staged: string[]): WorkspaceModel {
  const firmware = {
    compareSettings: () => Promise.resolve(null),
    stageSettings: (id: string) => {
      staged.push(id);
      setDraft('1mi', 4);
      return Promise.resolve(null);
    },
    exportSettings: () => Promise.resolve(),
    deleteSettings: () => Promise.resolve(),
    importSettings: () => Promise.resolve(null),
  } as unknown as FirmwareActions;
  return { live: signal(view), actions: signal({ firmware, backup: () => undefined }) } as unknown as WorkspaceModel;
}

const render = (view: LiveView, staged: string[] = []): El => root(h(BackupsSection, { model: model(view, staged) }));
const withHub = (hub: FirmwareHubView, o: Parameters<typeof boardView>[0] = {}): LiveView => ({ ...boardView({ settings: { '1mi': 8, xvm: 16000 }, ...o }), firmware: hub });

beforeEach(() => {
  clearDraft();
  boardTab.value = 'backups';
});

describe('BackupsSection', () => {
  it('empty: says what a backup is, with Back up settings beside the heading', () => {
    const el = render(withHub(HUB([])));
    expect(text(el)).toContain('No backups of this board yet.');
    expect(one(el, byAttr('data-action', 'backup')).props['class']).toContain('primary');
  });

  it('one way to bring a file in: exactly one file input, labelled "Add a backup file…"; no "Restore from a file"', () => {
    const el = render(withHub(HUB([ROW()])));
    const inputs = all(el, (e) => e.tag === 'input' && e.props['type'] === 'file');
    expect(inputs.map((i) => i.props['data-action'])).toEqual(['backup-import']);
    expect(text(el)).toContain('Add a backup file…');
    expect(text(el)).not.toContain('Restore from a file');
  });

  it('the list: Taken, Why, Firmware, Board, Settings, with the Why words', () => {
    const el = render(withHub(HUB([ROW(), ROW({ id: 'b2', trigger: 'before-apply' }), ROW({ id: 'b3', trigger: 'before-update' }), ROW({ id: 'b4', trigger: 'import', boardId: 'OTHER' })])));
    expect(all(one(el, (e) => e.tag === 'thead'), (e) => e.tag === 'th').map(text).slice(0, 5)).toEqual(['Taken', 'Why', 'Firmware', 'Board', 'Settings']);
    expect(all(el, byAttr('data-backup-why')).map(text)).toEqual(['Manual', 'Before an apply', 'Before a firmware update', 'Added from a file']);
    expect(text(one(el, byAttr('data-backup-row', 'b4')))).toContain('another board');
    expect(text(one(el, byAttr('data-backup-row', 'b1')))).toContain('this board');
    expect(text(one(el, byAttr('data-backup-row', 'b1')))).toContain('186');
  });

  it('Compare shows each differing setting in words from the definitions', () => {
    const compare = { id: 'b1', changes: 1, same: 185, skipped: 0, keys: ['1mi'], diffs: [{ key: '1mi', backup: 4, board: 8 }] };
    const diff = one(render(withHub(HUB([ROW()], compare))), byAttr('data-compare', 'b1'));
    expect(text(diff)).toContain('Motor 1 microsteps');
    expect(text(diff)).toContain('Quarter step (4)');
    expect(text(diff)).toContain('Eighth step (8)');
  });

  it('Compare: the board column in the board\'s units, the backup column in the backup\'s units (review finding 1)', () => {
    const compare = { id: 'b1', changes: 1, same: 185, skipped: 0, keys: ['xvm'], backupInches: false, diffs: [{ key: 'xvm', backup: 16000, board: 630 }] };
    const diff = one(render(withHub(HUB([ROW()], compare), { unit: 0 })), byAttr('data-compare', 'b1'));
    expect(text(diff)).toContain('16 000 mm/min');
    expect(text(diff)).toContain('630 in/min');
  });

  it('Restore stages pending changes and switches to the tab of the first change', async () => {
    const staged: string[] = [];
    const el = render(withHub(HUB([ROW()])), staged);
    (one(el, byAttr('data-action', 'backup-restore')).props['onClick'] as () => void)();
    await Promise.resolve();
    await Promise.resolve();
    expect(staged).toEqual(['b1']);
    expect(boardTab.value).toBe('motors');
  });

  it('Restore is absent on a read-only board; Compare and Download stay', () => {
    const el = render(withHub(HUB([ROW()]), OWNER_449));
    expect(all(el, byAttr('data-action', 'backup-restore'))).toEqual([]);
    expect(all(el, byAttr('data-action', 'backup-compare'))).toHaveLength(1);
    expect(all(el, byAttr('data-action', 'backup-export'))).toHaveLength(1);
  });
});
