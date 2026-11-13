import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Bubble phase only: T-S18's capture-phase Escape pause must run unchanged. */
export function listenDialogDismiss(root: HTMLElement, dismiss: () => void, plainCard = false): () => void {
  const doc = root.ownerDocument;
  let pressedOutside = false;
  const top = (): boolean => {
    const dialogs = [...doc.querySelectorAll<HTMLElement>('.dialog-wrap')].filter(el => el.getClientRects().length > 0);
    return plainCard ? dialogs.length === 0 && root.getClientRects().length > 0 : dialogs.at(-1) === root;
  };
  const key = (e: KeyboardEvent): void => {
    if ((e.key === 'Escape' || e.key === 'Esc') && top()) dismiss();
  };
  const down = (e: PointerEvent): void => { pressedOutside = e.target === root && e.button === 0; };
  const cancel = (): void => { pressedOutside = false; };
  const click = (e: MouseEvent): void => {
    const outside = pressedOutside && e.target === root;
    pressedOutside = false;
    if (!plainCard && outside && top()) dismiss();
  };
  doc.addEventListener('keydown', key);
  root.addEventListener('pointerdown', down);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('click', click);
  return () => {
    doc.removeEventListener('keydown', key);
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('pointercancel', cancel);
    root.removeEventListener('click', click);
  };
}

/** One lifecycle for dismissible dialogs; a dirty draft requires an explicit discard. */
export function useDialogDismiss(onClose: () => void, dirty = false, returnFocus?: HTMLElement | null, plainCard = false) {
  const ref = useRef<HTMLDivElement>(null);
  // Capture before child autofocus refs run, so confirmation dialogs restore their opener too.
  const opener = useRef(returnFocus ?? (typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null));
  const current = useRef({ onClose, dirty }); current.current = { onClose, dirty };
  const [asking, setAsking] = useState(false);
  useLayoutEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const stop = listenDialogDismiss(root, () => {
      if (current.current.dirty) setAsking(true);
      else current.current.onClose();
    }, plainCard);
    return () => {
      stop();
      if (plainCard) return; // An inline card never owns or restores focus.
      queueMicrotask(() => {
        if (root.ownerDocument.activeElement?.closest('.dialog-wrap') != null) return;
        if (opener.current?.isConnected) opener.current.focus();
        else root.ownerDocument.querySelector<HTMLElement>('[data-action="add-tool"]')?.focus();
      });
    };
  }, []);
  return { ref, asking, keepEditing: () => setAsking(false), discard: () => current.current.onClose() };
}
