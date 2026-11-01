/**
 * C1 at every LIVE session start (ROADMAP P1-05; SAFETY §6 C1, HIL-1.3).
 *
 * The full list is shown the first time, when the text version changes, and
 * when the last full acceptance in THIS browser was on an earlier calendar
 * day; otherwise the short form. Either form must be accepted for every LIVE
 * session: nothing here remembers a short acceptance. A full acceptance is
 * stored in `device-safety` as `ack.safety@<version>@<date>`; the account's
 * copy (A1) is display-only and is never read here.
 *
 * The text version is derived from the full text itself, so any change to
 * the wording in @synthetos/safety asks for the full form again.
 */
import { c1Full, c1Short, renderChecklist, type Checklist } from '@synthetos/safety';
import type { DeviceSafetyStore } from './deviceSafety.ts';

export type C1Form = 'full' | 'short';

/** FNV-1a 32-bit of a string, as 8 hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The C1 text version: a hash of the full form's exact text. */
export const C1_TEXT_VERSION = fnv1a(renderChecklist(c1Full()));

const PREFIX = 'ack.safety@';

/** This browser's local calendar day, `YYYY-MM-DD`. */
export function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function c1Key(version: string, now: Date): string {
  return `${PREFIX}${version}@${localDay(now)}`;
}

/** Which form this LIVE session must show. Anything unreadable gives the full form. */
export async function c1FormFor(store: DeviceSafetyStore, now: Date, version: string = C1_TEXT_VERSION): Promise<C1Form> {
  try {
    const keys = await store.keys(`${PREFIX}${version}@`);
    return keys.includes(c1Key(version, now)) ? 'short' : 'full';
  } catch {
    return 'full';
  }
}

/** Records an accepted FULL form (a short acceptance is never stored). Older records are removed. */
export async function recordC1(store: DeviceSafetyStore, form: C1Form, now: Date, version: string = C1_TEXT_VERSION): Promise<void> {
  if (form !== 'full') return;
  const key = c1Key(version, now);
  await store.set(key, { acceptedAt: now.toISOString() });
  for (const old of await store.keys(PREFIX)) if (old !== key) await store.delete(old);
}

export function c1Checklist(form: C1Form): Checklist {
  return form === 'full' ? c1Full() : c1Short();
}
