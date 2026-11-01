/**
 * Leaving fullscreen on entering LIVE (ROADMAP P1-05; SAFETY §4.6): the
 * safety bar, the stop button and the browser's own controls must be visible
 * while a machine is connected. Failure to leave is ignored: it must never
 * block the connect that a user is making.
 */
export interface FullscreenDocument {
  readonly fullscreenElement: Element | null;
  exitFullscreen(): Promise<void>;
}

export async function leaveFullscreen(doc: FullscreenDocument): Promise<boolean> {
  if (doc.fullscreenElement === null) return false;
  try {
    await doc.exitFullscreen();
  } catch {
    return false;
  }
  return true;
}
