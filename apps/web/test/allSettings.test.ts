/**
 * All settings at both levels (Board settings spec §5.7, OD-44): every reported setting, grouped by the data's
 * groups, "No definition yet" last; Simple shows plain names and values only; Advanced adds the token beside them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { settingsDefsFor } from '@synthetos/schema';
import { clearDraft, setDraft } from '../src/workspace/boardFacts.ts';
import { uiLevel } from '../src/workspace/jobWorkflow.ts';
import { AllSettings } from '../src/workspace/settings/AllSettings.ts';
import { allSettingsRows } from '../src/workspace/settings/allSettingsModel.ts';
import { boardView } from './boardViews.ts';

const d450 = settingsDefsFor('tinyg-en')!;
const SETTINGS = { '1mi': 2, '1ma': 0, xvm: 800, gun: 1, ex: 1, baud: 5, ej: 1, fb: 450.06, zz9: 4, g54x: 10 };
const Q = { text: '', group: null, pendingOnly: false, level: 'advanced' } as const;
const html = (level: 'simple' | 'advanced', settings: Record<string, number> = SETTINGS): string => {
  uiLevel.set(level);
  return renderToString(h(AllSettings, { view: boardView({ settings }) }));
};

beforeEach(() => {
  clearDraft();
  uiLevel.set('simple');
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

describe('AllSettings', () => {
  it('Advanced lists every reported key; Simple every key but the ones Run owns (ex, baud, ej)', () => {
    expect([...html('advanced').matchAll(/data-key="/g)]).toHaveLength(Object.keys(SETTINGS).length);
    expect([...html('simple').matchAll(/data-key="/g)]).toHaveLength(Object.keys(SETTINGS).length - 3);
  });

  it('Simple shows no token; Advanced puts the token beside the name, in the name cell (OD-44, review finding 5)', () => {
    expect(html('simple')).not.toContain('class="raw-key"');
    const adv = html('advanced');
    expect(adv).not.toMatch(/<th[^>]*>Token<\/th>/);
    expect(adv).toMatch(/data-key="1mi"[^>]*><th scope="row">Motor 1 microsteps<code class="raw-key">1mi<\/code>/);
  });

  it('each value shows once in its row (review finding 10)', () => {
    const fb = /<tr[^>]*data-key="fb"[\s\S]*?<\/tr>/.exec(html('simple'))?.[0] ?? '';
    expect(fb.match(/450\.06/g)).toHaveLength(1);
    expect(html('simple')).not.toMatch(/<th[^>]*>On the board<\/th>/);
  });

  it('the Status report group lists the report fields in words, from the data file (moved from the Communications tab)', () => {
    uiLevel.set('advanced');
    const v = boardView({ settings: { ...SETTINGS, si: 250 } });
    const m = v.message as NonNullable<typeof v.message>;
    const view = { ...v, message: { ...m, snapshot: { ...m.snapshot, live: { ...m.snapshot.live, srList: ['stat', 'posx', 'spe'] } } } };
    const out = renderToString(h(AllSettings, { view }));
    const sr = /<tbody[^>]*data-group="status-report"[\s\S]*?<\/tbody>/.exec(out)?.[0] ?? '';
    expect(sr).toMatch(/data-status-fields[\s\S]*Machine state[\s\S]*X position[\s\S]*Spindle on/);
  });

  it('settings Run owns are listed at Advanced only, read-only, with the one reason in the group header (lead decision 2026-11-19)', () => {
    const ids = (level: 'simple' | 'advanced'): string[] => allSettingsRows(d450, SETTINGS, {}, { ...Q, level }).map((g) => g.group.id);
    expect(ids('simple')).not.toContain('communications');
    expect(ids('advanced')).toContain('communications');
    expect(html('simple')).not.toContain('data-group="communications"');
    const out = html('advanced');
    expect(out.match(/Run sets this itself\. Changing it could cut the connection\./g)).toHaveLength(1);
    const comms = /<tbody[^>]*data-group="communications"[\s\S]*?<\/tbody>/.exec(out)?.[0] ?? '';
    expect(comms).not.toContain('data-lock');
    expect(comms).not.toMatch(/data-control-kind="(segmented|select|number)"/);
  });

  it('a read setting in a mixed group carries its reason; the footer points to the live readouts', () => {
    expect(html('simple', { ...SETTINGS, gco: 1 })).toMatch(/data-key="gco"[\s\S]*?data-lock[^>]*>Run doesn't change this setting\./);
    expect(html('simple', { ...SETTINGS, gco: 1 })).not.toContain('yet.');
    expect(html('simple')).toContain('Live readouts (input states, homed axes, positions) are on Inputs, Axes and the Job view.');
  });

  it('a pending change is marked in its row', () => {
    setDraft('xvm', 900);
    expect(html('simple')).toMatch(/data-key="xvm"[^>]*class="drafted"/);
  });
});
