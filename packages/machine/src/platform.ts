/**
 * Live control is refused on mobile operating systems, whatever the
 * browser's API reports (ROADMAP P1-03; RUN_PLAN §2.3; SAFETY §1, §4.1
 * Enter LIVE; T-S77). Mobile operating systems freeze and kill background
 * tabs aggressively, which pushes host loss towards L4. ChromeOS waits for
 * its own review. Anything that is not recognisably Windows, macOS or
 * desktop Linux is refused too (fail closed).
 *
 * The check reads `userAgentData` where the browser has it (Chromium,
 * including in workers) and the user-agent string otherwise. iPadOS reports
 * a Macintosh user agent; a touch-capable "Macintosh" is treated as iPadOS.
 */

/** The parts of `navigator` (or `WorkerNavigator`) the check reads. */
export interface PlatformInfo {
  readonly userAgent?: string;
  readonly maxTouchPoints?: number;
  readonly userAgentData?: { readonly mobile?: boolean; readonly platform?: string } | undefined;
}

export type PlatformDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: 'mobile-os' | 'chromeos' | 'unsupported-os'; readonly reason: string };

const OFFLINE = 'You can still use the library, preview, machine profiles and wiring.';

const REFUSALS = Object.freeze({
  'mobile-os': `Live machine control is not available on phone or tablet operating systems, even when the browser offers Web Serial. ${OFFLINE}`,
  chromeos: `Live machine control is not available on ChromeOS yet. ${OFFLINE}`,
  'unsupported-os': `Live machine control needs Windows, macOS or Linux. ${OFFLINE}`,
});

function refuse(code: keyof typeof REFUSALS): PlatformDecision {
  return Object.freeze({ allowed: false, code, reason: REFUSALS[code] });
}

/** May this platform offer Connect and LIVE at all? */
export function liveControlPlatform(info: PlatformInfo | undefined): PlatformDecision {
  const ua = typeof info?.userAgent === 'string' ? info.userAgent : '';
  const data = info?.userAgentData;
  const hinted = typeof data?.platform === 'string' ? data.platform.toLowerCase() : '';
  if (data?.mobile === true || hinted === 'android' || hinted === 'ios') return refuse('mobile-os');
  if (/Android|iPhone|iPad|iPod|Mobi|Windows Phone|webOS|BlackBerry/i.test(ua)) return refuse('mobile-os');
  if (hinted === 'chrome os' || hinted === 'chromeos' || /\bCrOS\b/.test(ua)) return refuse('chromeos');
  const touch = typeof info?.maxTouchPoints === 'number' ? info.maxTouchPoints : 0;
  if (/Macintosh/.test(ua) && touch > 1) return refuse('mobile-os');
  if (hinted === 'windows' || hinted === 'macos' || hinted === 'linux') return Object.freeze({ allowed: true });
  if (/Windows NT|Macintosh|X11|Linux x86_64|Linux aarch64|Linux i686/.test(ua)) return Object.freeze({ allowed: true });
  return refuse('unsupported-os');
}
