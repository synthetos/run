/**
 * Step 4 of the firmware update (flashService.ts): the backups go to the page, and nothing is written until the page
 * answers that it stored them, with the image backup's SHA-256 as this worker computed it.
 */
import type { SessionClock } from '@synthetos/machine';
import { X192A3, crc16, sha256Hex, toIntelHex, type FlashBackups } from '@synthetos/flasher';

/** How long the page has to store the backups before the run gives up (nothing written). */
export const BACKUP_SAVE_MS = 60_000;

/** The backups the page must store before anything is written. Posted once per run. */
export interface FlashBackupsMessage {
  readonly id: number;
  readonly boardId: string | null;
  readonly fb: number | null;
  readonly fv: number | null;
  readonly eeprom: Uint8Array;
  /** The whole application section as Intel HEX (the firmware image backup). */
  readonly hex: string;
  readonly sha256: string;
  readonly crc: number;
}

type Board = { readonly id: string | null; readonly fb: number | null; readonly fv: number | null } | null;

export class BackupsWait {
  readonly #clock: SessionClock;
  readonly #post: (message: FlashBackupsMessage) => void;
  #pending: { readonly resolve: () => void; readonly reject: (e: Error) => void; readonly sha256: string } | null = null;

  constructor(clock: SessionClock, post: (message: FlashBackupsMessage) => void) {
    this.#clock = clock;
    this.#post = post;
  }

  /** Posts run `id`'s backups and resolves once the page confirmed it stored them; rejects after BACKUP_SAVE_MS. */
  async save(id: number, board: Board, backups: FlashBackups): Promise<void> {
    const hex = toIntelHex(backups.flash, X192A3);
    const sha256 = await sha256Hex(hex);
    const message: FlashBackupsMessage = { id, boardId: board?.id ?? null, fb: board?.fb ?? null, fv: board?.fv ?? null, eeprom: backups.eeprom, hex, sha256, crc: crc16(backups.flash) };
    return new Promise<void>((resolve, reject) => {
      const timer = this.#clock.setTimeout(() => {
        if (this.#pending?.sha256 !== sha256) return;
        this.#pending = null;
        reject(new Error('the page did not confirm that it stored the backups'));
      }, BACKUP_SAVE_MS);
      const settle = (): void => this.#clock.clearTimeout(timer);
      this.#pending = { sha256, resolve: () => { settle(); resolve(); }, reject: (e) => { settle(); reject(e); } };
      this.#post(message);
    });
  }

  /** The page stored the backups: null when `sha256` is the image backup's; else why not (the wait then fails). */
  confirm(sha256: string): string | null {
    const w = this.#pending;
    if (w === null) return 'No backups are waiting to be saved.';
    this.#pending = null;
    if (sha256 === w.sha256) {
      w.resolve();
      return null;
    }
    w.reject(new Error('the stored image backup is not the one read from the board'));
    return 'The stored image backup does not match what was read from the board.';
  }

  /** Stop waiting: the pending save rejects with `why`, when given. */
  drop(why?: Error): void {
    if (why !== undefined) this.#pending?.reject(why);
    this.#pending = null;
  }
}
