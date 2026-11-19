/**
 * All settings at both levels (Board settings spec §5.7, OD-44): every reported setting, grouped by the data's
 * groups, "No definition yet" last; Simple shows plain names and values only; Advanced adds the token beside them.
 * Owner walk 2026-11-19: no scrolling, so the group chips act as tabs (one group at a time), search and "Only
 * pending" look across all groups, and the rows page to fit the window.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { settingsDefsFor } from '@synthetos/schema';
import { clearDraft, setDraft } from '../src/workspace/boardFacts.ts';
import { uiLevel } from '../src/workspace/jobWorkflow.ts';
import { AllSettings, settingsGroup } from '../src/workspace/settings/AllSettings.ts';
import { pageOf } from '../src/workspace/paging.ts';
import { allSettingsRows, settingsItems } from '../src/workspace/settings/allSettingsModel.ts';
import { boardView } from './boardViews.ts';

const d450 = settingsDefsFor('tinyg-en')!;
const SETTINGS = { '1mi': 2, '1ma': 0, xvm: 800, gun: 1, ex: 1, baud: 5, ej: 1, fb: 450.06, zz9: 4, g54x: 10 };
const Q = { text: '', group: null, pendingOnly: false, level: 'advanced' } as const;
/** All settings at `level`, showing group `group` (the first group when null). */
const html = (level: 'simple' | 'advanced', settings: Record<string, number> = SETTINGS, group: string | null = null): string => {
  uiLevel.set(level);
  settingsGroup.value = group;
  return renderToString(h(AllSettings, { view: boardView({ settings }) }));
};
const keysIn = (out: string): string[] => [...out.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1] as string);

beforeEach(() => {
  clearDraft();
  uiLevel.set('simple');
  settingsGroup.value = null;
});

describe('allSettingsRows', () => {
  it('lists every reported key once, in the data\'s groups, with "No definition yet" last', () => {
    const groups = allSettingsRows(d450, SETTINGS, {}, Q);
    expect(groups.flatMap((g) => g.rows).sort()).toEqual(Object.keys(SETTINGS).sort());
    expect(groups.at(-1)?.group.title).toBe('No definition yet');
    expect(groups.at(-1)?.rows).toEqual(['zz9']);
    expect(groups.map((g) => g.group.id)).toEqual(['system', 'identity', 'communications', 'motor-1', 'axis-x', 'offsets', 'none']);
  });

  it('search finds a setting by its value words, its name or its token', () => {
    expect(allSettingsRows(d450, SETTINGS, {}, { ...Q, text: 'half' }).flatMap((g) => g.rows)).toEqual(['1mi']);
    expect(allSettingsRows(d450, SETTINGS, {}, { ...Q, text: 'flow' }).flatMap((g) => g.rows)).toEqual(['ex']);
    expect(allSettingsRows(d450, SETTINGS, {}, { ...Q, text: 'xvm' }).flatMap((g) => g.rows)).toEqual(['xvm']);
  });

  it('a group chip and "Only pending" narrow the list', () => {
    expect(allSettingsRows(d450, SETTINGS, {}, { ...Q, group: 'communications' }).flatMap((g) => g.rows).sort()).toEqual(['baud', 'ej', 'ex']);
    expect(allSettingsRows(d450, SETTINGS, { xvm: 900 }, { ...Q, pendingOnly: true }).flatMap((g) => g.rows)).toEqual(['xvm']);
  });

  it('a dialect with no file lists everything under "No definition yet"', () => {
    const groups = allSettingsRows(null, SETTINGS, {}, Q);
    expect(groups).toHaveLength(1);
    expect([...(groups[0]?.rows ?? [])].sort()).toEqual(Object.keys(SETTINGS).sort());
  });
});

describe('paging (owner walk 2026-11-19: no scrolling)', () => {
  it('one group is its rows alone; a search across groups puts a title line before each group\'s rows', () => {
    const one = allSettingsRows(d450, SETTINGS, {}, { ...Q, group: 'system' });
    expect(settingsItems(one, false).map((i) => (i.kind === 'row' ? i.key : `#${i.group.id}`))).toEqual(['gun']);
    const across = allSettingsRows(d450, SETTINGS, {}, { ...Q, text: 'motor' });
    expect(settingsItems(across, true).map((i) => (i.kind === 'row' ? i.key : `#${i.group.id}`))).toEqual(['#motor-1', '1ma', '1mi']);
  });

  it('pageOf cuts a list into pages of a size, and keeps the page in range', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(pageOf(items, 0, 2)).toEqual({ items: ['a', 'b'], page: 0, pages: 3 });
    expect(pageOf(items, 2, 2)).toEqual({ items: ['e'], page: 2, pages: 3 });
    expect(pageOf(items, 9, 2)).toEqual({ items: ['e'], page: 2, pages: 3 });
    expect(pageOf(items, 0, Number.POSITIVE_INFINITY)).toEqual({ items, page: 0, pages: 1 });
    expect(pageOf([], 0, 2)).toEqual({ items: [], page: 0, pages: 1 });
  });
});

describe('AllSettings', () => {
  it('the chips are the groups with settings, and act as tabs: the first group shows alone', () => {
    const out = html('advanced');
    expect([...out.matchAll(/data-group-chip="([^"]+)"/g)].map((m) => m[1])).toEqual(['system', 'identity', 'communications', 'motor-1', 'axis-x', 'offsets', 'none']);
    expect(out).toMatch(/data-group-chip="system"[^>]*aria-pressed="true"/);
    expect(keysIn(out)).toEqual(['gun']);
    expect(keysIn(html('advanced', SETTINGS, 'motor-1')).sort()).toEqual(['1ma', '1mi']);
  });

  it('Simple leaves out the groups Run owns (ex, baud, ej)', () => {
    expect(html('simple')).not.toContain('data-group-chip="communications"');
  });

  it('Simple shows no token; Advanced puts the token beside the name, in the name cell (OD-44, review finding 5)', () => {
    expect(html('simple', SETTINGS, 'motor-1')).not.toContain('class="raw-key"');
    const adv = html('advanced', SETTINGS, 'motor-1');
    expect(adv).not.toMatch(/<th[^>]*>Token<\/th>/);
    expect(adv).toMatch(/data-key="1mi"[^>]*><th scope="row">Motor 1 microsteps<code class="raw-key">1mi<\/code>/);
  });

  it('each value shows once in its row (review finding 10)', () => {
    const fb = /<tr[^>]*data-key="fb"[\s\S]*?<\/tr>/.exec(html('simple', SETTINGS, 'identity'))?.[0] ?? '';
    expect(fb.match(/450\.06/g)).toHaveLength(1);
    expect(html('simple')).not.toMatch(/<th[^>]*>On the board<\/th>/);
  });

  it('the description opens in one line under the group, not as a row that pushes the list down', () => {
    expect(html('simple', SETTINGS, 'motor-1')).not.toContain('desc-row');
    expect(html('simple', SETTINGS, 'motor-1')).toContain('data-settings-desc');
  });

  it('the Status report group lists the report fields in words, from the data file (moved from the Communications tab)', () => {
    uiLevel.set('advanced');
    settingsGroup.value = 'status-report';
    const v = boardView({ settings: { ...SETTINGS, si: 250 } });
    const m = v.message as NonNullable<typeof v.message>;
    const view = { ...v, message: { ...m, snapshot: { ...m.snapshot, live: { ...m.snapshot.live, srList: ['stat', 'posx', 'spe'] } } } };
    const out = renderToString(h(AllSettings, { view }));
    expect(out).toMatch(/data-status-fields[\s\S]*Machine state[\s\S]*X position[\s\S]*Spindle on/);
  });

  it('settings Run owns are listed at Advanced only, read-only, with the one reason in the group header (lead decision 2026-11-19)', () => {
    const ids = (level: 'simple' | 'advanced'): string[] => allSettingsRows(d450, SETTINGS, {}, { ...Q, level }).map((g) => g.group.id);
    expect(ids('simple')).not.toContain('communications');
    expect(ids('advanced')).toContain('communications');
    const out = html('advanced', SETTINGS, 'communications');
    expect(out.match(/Run sets this itself\. Changing it could cut the connection\./g)).toHaveLength(1);
    expect(keysIn(out).sort()).toEqual(['baud', 'ej', 'ex']);
    expect(out).not.toContain('data-lock');
    expect(out).not.toMatch(/data-control-kind="(segmented|select|number)"/);
  });

  it('a read setting in a mixed group carries its reason; the footer points to the live readouts', () => {
    expect(html('simple', { ...SETTINGS, gco: 1 })).toMatch(/data-key="gco"[\s\S]*?data-lock[^>]*>Run doesn't change this setting\./);
    expect(html('simple', { ...SETTINGS, gco: 1 })).not.toContain('yet.');
    expect(html('simple')).toContain('Live readouts (input states, homed axes, positions) are on Inputs, Axes and the Job view.');
  });

  it('a pending change is marked in its row', () => {
    setDraft('xvm', 900);
    expect(html('simple', SETTINGS, 'axis-x')).toMatch(/data-key="xvm"[^>]*class="drafted"/);
  });
});
