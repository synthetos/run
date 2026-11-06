/**
 * Settings in RAM and EEPROM, keyed by the vendored token table.
 *
 * A SET changes the RAM value; a token whose table entry says `persist`
 * is also written to the EEPROM image (`nv_persist`, @cite EN config.c:220-226).
 * A reset reloads RAM from EEPROM for persisted tokens and from the model's
 * defaults for the rest. The EEPROM image is a plain object so a test can
 * keep it across a "power cycle" or hand a model the image another build
 * left behind.
 */
import '../marker.ts';
import { token, type FirmwareTable } from './table.ts';

export type SettingValue = number | string;
export type EepromImage = Record<string, number>;

export class Settings {
  readonly table: FirmwareTable;
  readonly #defaults: Readonly<Record<string, SettingValue>>;
  readonly eeprom: EepromImage;
  readonly #ram = new Map<string, SettingValue>();

  constructor(table: FirmwareTable, defaults: Readonly<Record<string, SettingValue>>, eeprom: EepromImage) {
    for (const name of Object.keys(defaults)) {
      if (token(table, name) === undefined && !name.startsWith('__')) throw new Error(`${table.name}: default for unknown token ${name}`);
    }
    this.table = table;
    this.#defaults = defaults;
    this.eeprom = eeprom;
  }

  /** Load RAM: persisted tokens from EEPROM when present, everything else from defaults. */
  load(): void {
    this.#ram.clear();
    for (const [name, value] of Object.entries(this.#defaults)) this.#ram.set(name, value);
    for (const [name, value] of Object.entries(this.eeprom)) {
      if (token(this.table, name)?.persist === true) this.#ram.set(name, value);
    }
  }

  /** Write every default to RAM and to EEPROM (first boot, or a build/layout change). */
  resetToDefaults(): void {
    for (const key of Object.keys(this.eeprom)) delete this.eeprom[key];
    this.#ram.clear();
    for (const [name, value] of Object.entries(this.#defaults)) {
      this.#ram.set(name, value);
      if (typeof value === 'number' && token(this.table, name)?.persist === true) this.eeprom[name] = value;
    }
  }

  get(name: string): SettingValue | undefined {
    return this.#ram.get(name);
  }

  num(name: string): number {
    const v = this.#ram.get(name);
    return typeof v === 'number' ? v : 0;
  }

  setRam(name: string, value: SettingValue): void {
    this.#ram.set(name, value);
  }

  /** Persist the RAM value of `name` if its token is persisted. Returns true when EEPROM changed. */
  persist(name: string): boolean {
    const info = token(this.table, name);
    const v = this.#ram.get(name);
    if (info?.persist !== true || typeof v !== 'number') return false;
    if (this.eeprom[name] === v) return false;
    this.eeprom[name] = v;
    return true;
  }
}
