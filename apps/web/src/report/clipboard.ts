/**
 * Copies text for "Copy report" and the forum hand-off. It uses a detached
 * textarea and the editing command, inside the click that asked for it, so
 * no clipboard capability is read from `navigator` (the capability gates admit
 * only a short list of navigator properties; tools/gates/src/shared/capabilities.ts).
 * The text is data: it goes into a textarea's value, never into markup.
 */
export function copyText(doc: Document, text: string): boolean {
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'clipboard-buffer';
  doc.body.appendChild(area);
  const active = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  try {
    area.select();
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    active?.focus();
  }
}
