/**
 * Step 7 (spec §6.3): the project that is open, one line on what to do next, and the "More to set up" rows
 * (moreTopics.ts), each collapsed with a link to the place in Run where it is done. Not skippable.
 */
import { h, type ComponentChild } from 'preact';
import { boardTab } from '../../workspace/boardNavigation.ts';
import { MORE_TOPICS, type Topic } from '../moreTopics.ts';

export const DONE_TITLE = 'You are set';
export const DONE_LEAD = 'Everything from here is on the Job page.';
export const DONE_NEXT = 'Place the job on the stock, check it, then run it.';
export const MORE_TITLE = 'More to set up';

/** The project the wizard made: open on the Job page when it has a file, otherwise waiting in Projects. */
export function doneHeadline(projectName: string | null, hasFile = true): string {
  if (projectName === null) return 'No project is open yet';
  return hasFile ? `${projectName} is open on the Job page` : `${projectName} is in Projects, with no files yet`;
}

function TopicRow({ topic, onView }: { readonly topic: Topic; readonly onView: (v: string) => void }): ComponentChild {
  const go = (): void => {
    if (topic.go.tab !== undefined) boardTab.value = topic.go.tab;
    onView(topic.go.view);
  };
  return h(
    'li',
    { key: topic.id },
    h(
      'details',
      null,
      h('summary', { class: 'wizard-topic-title' }, topic.title),
      h('div', { class: 'wizard-topic-body' }, topic.lines.map((line) => h('p', { key: line }, line)), h('button', { type: 'button', class: 'small', 'data-topic-go': topic.id, onClick: go }, topic.go.label)),
    ),
  );
}

export function Done(p: { readonly projectName: string | null; readonly hasFile?: boolean; readonly onView: (v: string) => void }): ComponentChild {
  return h(
    'div',
    { class: 'wizard-done' },
    h('p', { class: 'wizard-headline', 'data-wizard': 'headline' }, doneHeadline(p.projectName, p.hasFile ?? true)),
    h('p', { class: 'wizard-line' }, DONE_NEXT),
    h('h3', { class: 'wizard-more' }, MORE_TITLE),
    h('ul', { class: 'wizard-topics' }, MORE_TOPICS.map((topic) => h(TopicRow, { key: topic.id, topic, onView: p.onView }))),
  );
}
