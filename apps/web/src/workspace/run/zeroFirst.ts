/**
 * "Set work zero first" (owner, 2026-11-09): from the travel question, take the user to where work zero is set, the
 * Position panel's X, Y and Z Zero button, scrolled into view and focused. Moving there is theirs to do (jog to the
 * corner); nothing is sent.
 */
export function setWorkZeroFirst(doc: Document = document): void {
  const button = doc.querySelector<HTMLElement>('[data-region="position"] .pos-status-row [data-machine-control="zero"]') ?? doc.querySelector<HTMLElement>('[data-region="position"]');
  button?.scrollIntoView({ block: 'center' });
  button?.focus();
}
