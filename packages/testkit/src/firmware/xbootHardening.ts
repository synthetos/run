/** tg-xboot e607778 src/xboot.c:353–360, 556–611, 815–848. */
const WRITES = new Set([0x65, 0x42, 0x63, 0x43, 0x6d, 0x44, 0x6c]);
const COMMANDS = new Set([...'aAHebBgRcCDlxyTmdrFNQPLEptSVsh'].map((c) => c.charCodeAt(0)).concat(0x1b));

export class XbootHardening {
  #state: 'locked' | 'pending' | 'armed' = 'locked';
  #bad = 0;
  readonly enabled: boolean;
  constructor(enabled: boolean) { this.enabled = enabled; }
  reset(): void { this.#state = 'locked'; this.#bad = 0; }
  get mustReset(): boolean { return this.enabled && this.#bad >= 2; }
  select(code: number): void { this.#state = code === 123 ? 'pending' : 'locked'; }

  /** Called only for opcodes; payload bytes never enter the main parser. */
  command(op: number): boolean {
    if (!this.enabled) return true;
    const previous = this.#state;
    if (previous === 'pending') this.#state = 'locked';
    if (!COMMANDS.has(op) || (WRITES.has(op) && this.#state !== 'armed')) {
      this.#state = 'locked';
      this.#bad++;
      return false;
    }
    this.#bad = 0;
    if (op === 0x50 && previous !== 'locked') this.#state = 'armed';
    if (op === 0x4c || op === 0x45) this.#state = 'locked';
    return true;
  }
}
