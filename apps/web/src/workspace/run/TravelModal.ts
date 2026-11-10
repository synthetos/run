/**
 * What Start asks when the travel check needs you (OD-24): a move past the travel of an axis that is not homed (C41,
 * which also answers C36), or a travel that could not be checked (C40). Home the axis, start anyway (the
 * confirmation), or cancel. The registered text is under Details.
 */
import { h, type ComponentChild } from 'preact';
import { c40, c41 } from '@synthetos/safety';
import type { TravelAsk } from './readyModel.ts';
import { ChoiceModal, Details } from './ChoiceModal.ts';
import { travelPastText, travelUncheckedText } from './runCopy.ts';

export function TravelModal({ ask, onHome, onZero, onStart, onCancel }: { readonly ask: TravelAsk; readonly onHome?: () => void; readonly onZero?: () => void; readonly onStart: () => void; readonly onCancel: () => void }): ComponentChild {
  if (ask.kind === 'past') {
    const t = travelPastText(ask);
    // The board's work zero is not the plan's: that is the likely cause, so setting it leads; Start anyway follows.
    const zeroFirst = ask.zeroFirst === true && onZero !== undefined;
    return h(ChoiceModal, {
      title: t.title,
      body: zeroFirst ? `${t.body} Your work zero isn’t where you planned it.` : t.body,
      safety: 'C41',
      details: h(Details, { texts: [{ safety: 'C41', text: c41({ axis: ask.axis, line: ask.line, reach: ask.reach, limit: ask.limit, unit: ask.unit, more: ask.more }) }] }),
      choices: [
        ...(zeroFirst ? [{ id: 'travel-zero', label: 'Set work zero first', primary: true, onClick: onZero as () => void }] : []),
        ...(onHome === undefined ? [] : [{ id: 'travel-home', label: `Home ${ask.axis}`, onClick: onHome }]),
        { id: 'travel-start', label: 'Start anyway', primary: !zeroFirst, onClick: onStart },
        { id: 'travel-cancel', label: 'Cancel', onClick: onCancel },
      ],
    });
  }
  const t = travelUncheckedText(ask.why);
  return h(ChoiceModal, {
    title: t.title,
    body: t.body,
    safety: 'C40',
    details: h(Details, { texts: [{ safety: 'C40', text: c40({ why: ask.why }) }] }),
    choices: [
      { id: 'travel-start', label: 'Start anyway', primary: true, onClick: onStart },
      { id: 'travel-cancel', label: 'Cancel', onClick: onCancel },
    ],
  });
}
