/**
 * The reviewed `tinyg-en` overlay, now read from settings/tinyg-450.json
 * (Board settings spec §4.3). Kept only so existing imports keep working
 * until the web app reads definitions directly; test/settingsGolden.test.ts
 * proves the move changed no reviewed field.
 *
 * CODEOWNERS: the owner reviews every change.
 */
import { requireSettingsDefs } from '../settingsDefs/load.ts';
import { overlayFromDefs } from '../settingsDefs/overlay.ts';
import type { OverlayEntry } from './types.ts';

export const TINYG_EN_OVERLAY: readonly OverlayEntry[] = overlayFromDefs(requireSettingsDefs('tinyg-en'));
