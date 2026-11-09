/** The homing tag's words (first-time walk 2026-11-08, S2): "Homed" only for a homing this session saw. */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { HomingTag, positionTag, SET_BEFORE_HELP, SET_BY_HAND_HELP } from '../src/workspace/positionTag.ts';

describe('positionTag (S2)', () => {
  it('says Homed, in green, only after a homing cycle', () => {
    expect(positionTag(true, 'homing')).toEqual({ text: 'Homed', tone: 'ok', help: null });
  });
  it('says Position set by hand, in amber, after Set machine zero here (G28.3)', () => {
    expect(positionTag(true, 'hand')).toEqual({ text: 'Position set by hand', tone: 'warn', help: SET_BY_HAND_HELP });
  });
  it('never says Homed for a position this session did not see set', () => {
    expect(positionTag(true, undefined)).toEqual({ text: 'Position set before connecting', tone: 'warn', help: SET_BEFORE_HELP });
  });
  it('leaves Not homed to the caller and says when homing is unknown', () => {
    expect(positionTag(false, 'hand')).toBeNull();
    expect(positionTag(null, undefined)?.text).toBe('Homing unknown');
  });
  it('renders the amber word with its help on the word itself, no pill and no green class', () => {
    const html = renderToString(HomingTag(true, 'hand') as never);
    expect(html).toContain('class="pos-word warn"');
    expect(html).toContain('help-trigger help-words');
    expect(html).not.toContain('class="tag');
    expect(html).toContain('Position set by hand');
    expect(html).toContain('data-homed-by="hand"');
    expect(html).not.toContain('pos-word ok');
  });
});
