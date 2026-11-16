/** C1 checklist, or the repeat-connect chooser gesture (OD-30). */
import { h, type ComponentChild } from 'preact';
import { BOX } from '@synthetos/safety';
import { c1Checklist } from './c1.ts';

interface Props {
  readonly form: Parameters<typeof c1Checklist>[0];
  readonly onConfirm: (ticked: readonly boolean[]) => void;
  readonly onCancel: () => void;
}

function readTicks(form: HTMLFormElement): boolean[] {
  return [...form.querySelectorAll('input[type="checkbox"]')].map((el) => (el as HTMLInputElement).checked);
}

export function ConnectChecklist(props: Props): ComponentChild {
  const list = c1Checklist(props.form);
  return h('form', {
    class: 'live-entry c1', 'data-entry': 'c1', 'data-c1-form': props.form,
    ...(props.form === 'full' ? { 'data-safety': 'C1' } : {}),
    onSubmit: (event: Event) => {
      event.preventDefault();
      props.onConfirm(readTicks(event.currentTarget as HTMLFormElement));
    },
  },
  list.intro === undefined ? null : h('p', null, list.intro),
  ...list.boxes.map((box, i) => h('label', { class: 'c1-box', key: String(i) },
    h('input', { type: 'checkbox', name: `c1-${i}`, required: true, 'aria-label': `${BOX} ${box}` }), ` ${box}`)),
  h('div', { class: 'c1-actions' },
    h('button', { type: 'submit', class: 'button', 'data-action': 'confirm' }, props.form === 'full' ? 'Confirm and choose port' : 'Choose port'),
    h('button', { type: 'button', class: 'button', 'data-action': 'cancel', onClick: props.onCancel }, 'Cancel')));
}
