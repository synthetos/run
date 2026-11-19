/** The reviewed edge-next write entries, from settings/tinyg-450.json (what overlays/tinygEn.ts used to export). */
import { overlayFromDefs, requireSettingsDefs } from '../src/index.ts';
import type { OverlayEntry } from '../src/index.ts';

export const TINYG_EN_OVERLAY: readonly OverlayEntry[] = overlayFromDefs(requireSettingsDefs('tinyg-en'));
