import { h, type ComponentChild } from 'preact';

/**
 * Renders a SAFETY §5 string with its lead ("WARNING —", "NOT CONNECTED —")
 * in bold. The text content is the string exactly: the lead, one space, the
 * rest. Strings without " — " render unchanged.
 */
export function signalText(text: string): ComponentChild[] {
  const at = text.indexOf(' — ');
  if (at === -1) return [text];
  return [h('strong', { class: 'signal-word' }, text.slice(0, at + 2)), text.slice(at + 2)];
}
