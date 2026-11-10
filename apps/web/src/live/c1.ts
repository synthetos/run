/**
 * C1, once per browser (ROADMAP P1-05; SAFETY §6 C1 as amended by OD-30, owner 2026-11-09: "never show this to
 * anyone after the first set of check boxes").
 *
 * The full list is shown at the first Connect in this browser. Once it has been accepted, no form of C1 is shown
 * again in this browser: not the short form, not after a text change, not on a later day. The acceptance is stored
 * in `device-safety` as `ack.safety@<version>@<date>` (device-local, never synced, never cleared by sign-out); the
 * account's copy (A1) is display-only and is never read here. Anything unreadable shows the full list again: the
 * safe side.
 */
import { c1Full, renderChecklist, type Checklist } from '@synthetos/safety';
import type { DeviceSafetyStore } from './deviceSafety.ts';

/** `full`: the first Connect in this browser. `none`: C1 was accepted here before; nothing is asked. */
export type C1Form = 'full' | 'none';

/** FNV-1a 32-bit of a string, as 8 hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The C1 text version: a hash of the full form's exact text (kept in the record, for the log). */
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

/** Which form this Connect shows: the full list until it has been accepted once in this browser, then none. */
export async function c1FormFor(store: DeviceSafetyStore): Promise<C1Form> {
  try {
    return (await store.keys(PREFIX)).length > 0 ? 'none' : 'full';
  } catch {
    return 'full';
  }
}

/** Records an accepted full list. Nothing is recorded for `none`. */
export async function recordC1(store: DeviceSafetyStore, form: C1Form, now: Date, version: string = C1_TEXT_VERSION): Promise<void> {
  if (form !== 'full') return;
  await store.set(c1Key(version, now), { acceptedAt: now.toISOString() });
}

/** The checklist a form shows: the full list, or nothing. */
export function c1Checklist(form: C1Form): Checklist {
  return form === 'full' ? c1Full() : { ...c1Full(), boxes: [] };
}
