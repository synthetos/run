/**
 * When the trusted-build flow offers "Trust this build on this board" (SAFETY H87 mitigation 1, C38): the board
 * runs custom firmware this browser flashed onto it, and that exact image is not trusted on it yet. The Firmware
 * tab draws the offer; the Position panel's control card points to it. Nothing here grants anything.
 */
import type { FirmwareHubView, LiveView } from './model.ts';

export function trustOffered(view: LiveView | null, hub: FirmwareHubView | null): boolean {
  const installed = hub?.installed ?? null;
  const id = view?.message?.snapshot.identity?.id;
  if (hub === null || installed === null || installed.source !== 'custom' || typeof id !== 'string' || installed.boardId !== id) return false;
  return !hub.trust.some((t) => t.boardId === id && t.sha256 === installed.sha256);
}
