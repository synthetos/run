import { expect, it } from 'vitest';
import { visibleSettingGroups } from '../src/workspace/settings/visibleGroups.ts';
it('shows all five RAM-only spindle fields only on the appropriate firmware', () => {
  const group = visibleSettingGroups('tinyg-en', 450.06).find(g => g.token === 'spindle-readouts');
  expect(group?.members).toEqual(['sso', 'ssoe', 'ssc', 'scp', 'sse']);
  expect(group?.persisted).toBe(false);
  for (const fb of [undefined, 450.05]) expect(visibleSettingGroups('tinyg-en', fb).some(g => g.token === 'spindle-readouts')).toBe(false);
  expect(visibleSettingGroups('tinyg-440', 450.06).some(g => g.token === 'spindle-readouts')).toBe(false);
  expect(visibleSettingGroups(null, 450.06)).toEqual([]);
});
