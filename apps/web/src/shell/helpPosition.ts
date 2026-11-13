/** Viewport coordinates for top-layer help; no panel overflow can clip it. */
export function helpPosition(trigger: { left: number; right: number; top: number; bottom: number }, width: number, height: number, viewport: { width: number; height: number }, below: boolean, end: boolean): { left: number; top: number } {
  const gap = 8;
  const left = Math.max(gap, Math.min(end ? trigger.right - width : trigger.left, viewport.width - width - gap));
  const above = trigger.top - height - gap;
  const under = trigger.bottom + gap;
  const top = below ? (under + height <= viewport.height - gap ? under : above) : (above >= gap ? above : under);
  return { left, top: Math.max(gap, Math.min(top, viewport.height - height - gap)) };
}
