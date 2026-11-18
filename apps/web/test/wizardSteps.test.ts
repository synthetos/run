import { describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { all, byAttr, one, root, text } from './tree.ts';
import { Done, DONE_LEAD, DONE_TITLE, doneHeadline } from '../src/wizard/steps/Done.ts';
import { Welcome, WELCOME_LEAD, WELCOME_TITLE } from '../src/wizard/steps/Welcome.ts';
import { MORE_TOPICS } from '../src/wizard/moreTopics.ts';
import { FirstProject } from '../src/wizard/steps/FirstProject.ts';
import { Homing } from '../src/wizard/steps/Homing.ts';
import type { El } from './tree.ts';

/** Owner 148: the radio sits at the left of the card, beside a left-aligned title and description. */
function pickCards(el: El): El[] {
  return all(el, (e) => e.tag === 'label' && String(e.props['class'] ?? '').split(' ').includes('wizard-pick'));
}

describe('radio cards (owner 148)', () => {
  it('First project and Homing use the wizard pick card: radio first, then the title and the description', () => {
    const project = root(h('div', null, h(FirstProject, { choice: 'demo', onChoice: () => undefined, name: '', onName: () => undefined, error: null })));
    const homing = root(h('div', null, h(Homing, { model: null, choice: 'none', onChoice: () => undefined, mismatch: null })));
    for (const el of [project, homing]) {
      const cards = pickCards(el);
      expect(cards).toHaveLength(2);
      for (const card of cards) {
        const kids = card.children.filter((c): c is El => typeof c !== 'string');
        expect(kids[0]?.tag).toBe('input');
        expect(kids[0]?.props['type']).toBe('radio');
        expect(kids[0]?.props['class']).toBe('wizard-pick-radio');
        expect(kids[1]?.props['class']).toBe('wizard-pick-title');
        expect(kids[2]?.props['class']).toBe('wizard-pick-text');
      }
      expect(all(el, (e) => String(e.props['class'] ?? '').includes('pick-card'))).toHaveLength(0);
    }
  });
});

const FILLER = /E-stop|never need|Saved in this browser|within reach/;

describe('step 1 Welcome', () => {
  it('names the three things the account covers and the five-minute line, with no filler', () => {
    expect(WELCOME_TITLE).toBe('Welcome to Run');
    expect(WELCOME_LEAD).toBe('Your Synthetos account is ready. One sign-in now covers three things.');
    const el = root(h('div', null, h(Welcome, null)));
    const items = all(el, (e) => e.tag === 'li').map(text);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/^Run: /);
    expect(items[1]).toMatch(/^The forum: /);
    expect(items[2]).toMatch(/^Bug reports: /);
    expect(text(el)).toContain('Setup takes about five minutes. Every step can be skipped and finished later from Preferences.');
    expect(text(el)).not.toMatch(FILLER);
  });
});

describe('step 7 Done', () => {
  it('names the open project or says there is none', () => {
    expect(DONE_TITLE).toBe('You are set');
    expect(DONE_LEAD).toBe('Everything from here is on the Job page.');
    expect(doneHeadline('Name plate')).toBe('Name plate is open on the Job page');
    expect(doneHeadline('Bracket', false)).toBe('Bracket is in Projects, with no files yet');
    expect(doneHeadline(null)).toBe('No project is open yet');
  });
  it('shows the headline, one next line, and one collapsed row per topic with its link', () => {
    const onView = vi.fn();
    const el = root(h('div', null, h(Done, { projectName: 'Name plate', onView })));
    expect(text(one(el, byAttr('data-wizard', 'headline')))).toBe('Name plate is open on the Job page');
    expect(text(el)).toContain('Place the job on the stock, check it, then run it.');
    const rows = all(el, (e) => e.tag === 'details');
    expect(rows).toHaveLength(MORE_TOPICS.length);
    expect(rows.every((r) => r.props['open'] === undefined)).toBe(true);
    expect(all(el, (e) => e.tag === 'summary').map(text)).toEqual(MORE_TOPICS.map((t) => t.title));
    const go = all(el, byAttr('data-topic-go'));
    expect(go.map((b) => b.props['data-topic-go'])).toEqual(MORE_TOPICS.map((t) => t.id));
    (go[0]?.props['onClick'] as () => void)();
    expect(onView).toHaveBeenCalledWith(MORE_TOPICS[0]?.go.view);
    expect(text(el)).not.toMatch(FILLER);
  });
});
