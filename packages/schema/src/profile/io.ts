/**
 * Profile import, export and storage (ROADMAP TB-01; OLD TOOLS_PLAN §5.1
 * import and export rules; SAFETY H33, H34, §4.10 rule 3; T-S22, T-S47).
 *
 * - **Size first.** A profile file over `PROFILE_MAX_BYTES` is refused with
 *   `ProfileTooLarge` before it is decoded or parsed (UI: check `File.size`
 *   with `profileSizeError` before reading it at all).
 * - **Export** (`exportProfile`) and **storage** (`toStoredProfile`) build a
 *   canonical copy field by field from the v2 schema's fields. Anything not
 *   in the schema (facts, confirmations, overrides, acknowledgements,
 *   pending restores, cloud revision metadata) cannot be copied, even when a
 *   caller smuggles it in through a cast.
 * - **Import** (`importProfileBytes`, `importProfileText`) accepts v1 and v2
 *   files, imports no fact, and clears `boundDevice`, so the board must be
 *   re-bound on the first connect and every fact for the machine is
 *   needs-re-verify (apply the `profileImported` trigger to the fact store
 *   with the returned profile's id).
 *
 * Every result is a typed value, never an exception, whatever the input.
 */
import type { SchemaError } from '../jsonSchema.ts';
import { canonicalProfile } from './canonical.ts';
import { profileError, readProfileValue, v2Issues } from './migrate.ts';
import type { ProfileError, ProfileResult } from './migrate.ts';
import type { MachineProfileV2 } from './types.ts';

/** 5 MB (5 × 1024 × 1024 bytes): far above any real profile, small enough to parse safely in a tab. */
export const PROFILE_MAX_BYTES = 5 * 1024 * 1024;
/** Deepest JSON nesting accepted; a real profile nests six levels (legacy v1 wiring a few more). */
export const PROFILE_MAX_DEPTH = 32;
/** The export file extension (OLD TOOLS_PLAN §5.1). */
export const PROFILE_FILE_EXTENSION = '.synthetos.json';

/** `ProfileTooLarge` for a byte length over the limit (also for a negative or non-finite one), otherwise null. */
export function profileSizeError(byteLength: number): ProfileError | null {
  if (Number.isFinite(byteLength) && byteLength >= 0 && byteLength <= PROFILE_MAX_BYTES) return null;
  return Object.freeze({
    code: 'ProfileTooLarge',
    message: `A machine profile file is at most ${PROFILE_MAX_BYTES} bytes.`,
    issues: Object.freeze([]),
  });
}

/**
 * The UTF-8 length of `text`, counting no further than `limit + 1` (enough
 * to know it is too large without walking a huge string). A lone surrogate
 * counts as the three bytes of U+FFFD, as an encoder would write it.
 */
export function utf8Length(text: string, limit = PROFILE_MAX_BYTES): number {
  let bytes = 0;
  for (let i = 0; i < text.length && bytes <= limit; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Whether a parsed JSON value nests deeper than `max` (iterative: no recursion on hostile input). */
function deeperThan(value: unknown, max: number): boolean {
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length > 0) {
    const [v, depth] = stack.pop() as [unknown, number];
    if (typeof v !== 'object' || v === null) continue;
    if (depth > max) return true;
    for (const child of Object.values(v)) stack.push([child, depth + 1]);
  }
  return false;
}

/** Import a profile from a file's text. */
export function importProfileText(text: string): ProfileResult {
  const tooLarge = profileSizeError(utf8Length(text));
  if (tooLarge !== null) return profileError(tooLarge.code, tooLarge.message);
  return importParsed(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

/** Import a profile from a file's bytes. The length is checked before anything is decoded. */
export function importProfileBytes(bytes: Uint8Array): ProfileResult {
  const tooLarge = profileSizeError(bytes.byteLength);
  if (tooLarge !== null) return profileError(tooLarge.code, tooLarge.message);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return profileError('NotUtf8', 'The file is not UTF-8 text.');
  }
  return importParsed(text);
}

function parse(text: string): { ok: true; value: unknown } | { ok: false; result: ProfileResult } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, result: profileError('NotJson', 'The file is not JSON.') };
  }
  if (deeperThan(value, PROFILE_MAX_DEPTH)) {
    return { ok: false, result: profileError('TooDeep', `The file nests deeper than ${PROFILE_MAX_DEPTH} levels.`) };
  }
  return { ok: true, value };
}

function importParsed(text: string): ProfileResult {
  const parsed = parse(text);
  if (!parsed.ok) return parsed.result;
  const read = readProfileValue(parsed.value);
  if (!read.ok) return read;
  // Import rule (T-S22): the board must be re-bound on the first connect.
  return Object.freeze({ ...read, profile: canonicalProfile({ ...read.profile, boundDevice: null }) });
}

/**
 * Read a profile back from this browser's own store. Unlike an import it
 * keeps `boundDevice`: the binding was made by a connect on this computer.
 */
export function readStoredProfile(value: unknown): ProfileResult {
  if (deeperThan(value, PROFILE_MAX_DEPTH)) return profileError('TooDeep', `The stored profile nests deeper than ${PROFILE_MAX_DEPTH} levels.`);
  return readProfileValue(value);
}

/** Thrown by `exportProfile` and `toStoredProfile` for a profile that is not valid v2. */
export class ProfileInvalidError extends Error {
  readonly issues: readonly SchemaError[];
  constructor(issues: readonly SchemaError[]) {
    super(`The machine profile is not valid: ${issues.map((i) => `${i.path || '/'} ${i.message}`).join('; ')}`);
    this.name = 'ProfileInvalidError';
    this.issues = Object.freeze([...issues]);
  }
}

/** The canonical, frozen copy that is stored in `local-workspace`/`cloud-cache` (never `device-safety`). */
export function toStoredProfile(p: MachineProfileV2): MachineProfileV2 {
  let copy: MachineProfileV2;
  try {
    copy = canonicalProfile(p);
  } catch {
    // Structurally broken (a cast hid a missing object): the schema says where.
    throw new ProfileInvalidError(v2Issues(p));
  }
  const issues = v2Issues(copy);
  if (issues.length > 0) throw new ProfileInvalidError(issues);
  return copy;
}

/**
 * The `.synthetos.json` export text. It carries no facts, confirmations or
 * overrides: the copy is built from schema fields only. Throws
 * `ProfileInvalidError` for a profile that is not valid v2.
 */
export function exportProfile(p: MachineProfileV2): string {
  return `${JSON.stringify(toStoredProfile(p), null, 2)}\n`;
}
