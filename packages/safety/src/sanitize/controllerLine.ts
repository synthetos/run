/**
 * What a line that starts with a controller's own command character is, in words a hobbyist can act on (SAFETY §4.7
 * step 4: such a line is never sent inside job data and blocks the file). A file made for a GRBL machine (Estlcam
 * and others) often ends with a GRBL homing or unlock line (`$H`, `$HZ`, `$X`); TinyG reads `$` lines as its own
 * text-mode settings, `?` as a status request, `{` as a JSON command and `h` as help. The line stays a block; this
 * only says what it is and what to do.
 *
 * Pure.
 */

/** Longest piece of the line quoted back. */
const QUOTE_MAX = 24;

function quoted(code: string): string {
  const text = code.length > QUOTE_MAX ? `${code.slice(0, QUOTE_MAX)}…` : code;
  return JSON.stringify(text);
}

const POST = 'export the file with a TinyG post-processor';

/** The block message for `code`, a comment-free line whose first character is one of `$ ? H h {`. */
export function controllerLineMessage(code: string): string {
  const upper = code.replace(/\s+/g, '').toUpperCase();
  if (/^\$H[XYZABC]*$/.test(upper)) return `${quoted(code)} is a GRBL homing command; this file was made for a GRBL machine. Remove the line, or ${POST}.`;
  if (upper === '$X') return `${quoted(code)} is a GRBL unlock command (it clears an alarm); this file was made for a GRBL machine. Remove the line, or ${POST}.`;
  const first = code.charAt(0);
  if (first === '$') return `${quoted(code)} is a controller setting or command (a "$" line, as GRBL and TinyG text mode use), not G-code. Remove the line, or ${POST}.`;
  if (first === '?') return `${quoted(code)} is a status request to a controller, not G-code. Remove the line.`;
  if (first === '{') return `${quoted(code)} is a JSON command to the controller, not G-code. Remove the line.`;
  return `${quoted(code)} starts with "${first}", which TinyG reads as a controller command, not G-code. Remove the line, or ${POST}.`;
}
