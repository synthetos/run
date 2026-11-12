/** Display analysis only; sending independently checks against the live board. */
import type { DialectId } from '@synthetos/protocol';
import { PREVIEW_DIALECTS } from '../gcode-worker/pipeline.ts';

export function analysisDialect(connected: boolean, dialectId: DialectId | null | undefined): { dialect: DialectId; note: string | null } {
  if (connected && dialectId != null && PREVIEW_DIALECTS.includes(dialectId)) return { dialect: dialectId, note: null };
  return { dialect: 'tinyg-en', note: connected
    ? "Checked for TinyG edge-next. This board's firmware is not covered."
    : 'Checked for TinyG edge-next. Connect to check against your board.' };
}
