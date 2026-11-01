/**
 * The W25 banner for a READ_ONLY session (ROADMAP P1-03; SAFETY §8 W25;
 * RUN_PLAN §7 Connect / Disconnect).
 *
 * The reason shown is a fixed phrase per classifier reason, never text
 * from the board; `fb` is the probed number. The closing sentence offers
 * the firmware upgrade where the classifier offers one (D23), and "Use your
 * usual sender" otherwise.
 */
import { w25 } from '@synthetos/safety';
import type { ClassificationInfo } from './types.ts';
import type { SessionSnapshot } from './snapshot.ts';

const REASON_TEXT: Readonly<Record<ClassificationInfo['reason'], string>> = Object.freeze({
  'en-approved': 'approved build',
  'en-not-approved': 'not an approved build',
  'tg440-approved': 'approved build',
  'tg440-not-approved': 'TinyG 440.21, not yet approved for control',
  'stock-449': 'stock TinyG 449 firmware',
  'g2core-read-only': 'g2core, read-only in this release',
  'g2core-unknown-build': 'g2core build not recognised',
  conflict: 'its identity answers disagree',
  probeFailed: 'its identity could not be read',
  flowControl: 'RTS/CTS flow control (ex=2)',
});

/** The W25 text when the session is READ_ONLY, else null. */
export function readOnlyNotice(snapshot: Pick<SessionSnapshot, 'overlays' | 'classification' | 'identity'>): string | null {
  const c = snapshot.classification;
  if (c === null || c.mode !== 'readOnly' || !snapshot.overlays.includes('READ_ONLY')) return null;
  const fb = snapshot.identity?.fb;
  return w25({
    fb: typeof fb === 'number' && Number.isFinite(fb) ? `build ${fb}` : 'build unknown',
    reason: REASON_TEXT[c.reason],
    advice: c.upgradeOffer ? 'upgrade' : 'usual-sender',
  });
}
