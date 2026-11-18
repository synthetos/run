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

export function doneHeadline(projectName: string | null): string {
  return projectName === null ? 'No project is open yet' : `${projectName} is open on the Job page`;
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
      h('summary', null, topic.title),
      h('div', null, topic.lines.map((line) => h('p', { key: line }, line)), h('button', { type: 'button', class: 'small', 'data-topic-go': topic.id, onClick: go }, topic.go.label)),
    ),
  );
}

export function Done(p: { readonly projectName: string | null; readonly onView: (v: string) => void }): ComponentChild {
  return h(
    'div',
    { class: 'wizard-done' },
    h('p', { class: 'wizard-headline', 'data-wizard': 'headline' }, doneHeadline(p.projectName)),
    h('p', { class: 'wizard-line' }, DONE_NEXT),
    h('h3', { class: 'wizard-more' }, MORE_TITLE),
    h('ul', { class: 'wizard-topics' }, MORE_TOPICS.map((topic) => h(TopicRow, { key: topic.id, topic, onView: p.onView }))),
  );
}
