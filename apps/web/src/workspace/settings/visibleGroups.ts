/** Display-only groups; these labels are never sent as GET group tokens. */
import { settingsReadGroups, type SettingsGroup } from '@synthetos/schema';
export function visibleSettingGroups(dialect: string | null, fb?: number): readonly SettingsGroup[] {
  if (dialect === null) return [];
  const groups = settingsReadGroups(dialect);
  if (dialect !== 'tinyg-en' || fb === undefined || fb < 450.06) return groups;
  return [...groups, { token: 'spindle-readouts', title: 'Spindle override readouts', explanation: 'RAM-only values on TinyG 450.06. Override controls are not enabled here.', members: ['sso', 'ssoe', 'ssc', 'scp', 'sse'], persisted: false }];
}
