/** Material coolant words, in one place: the chip, its hover title, and the value under "Coolant" in Overview. */
import type { CoolantNeed } from '@synthetos/library';

/** The hover title: a whole phrase. */
export const COOLANT_TEXT: Readonly<Record<CoolantNeed, string>> = { required: 'Coolant required', recommended: 'Coolant recommended', none: 'No coolant needed', avoid: 'Avoid coolant' };

/** The short chip text. */
export const COOLANT_CHIP: Readonly<Record<CoolantNeed, string>> = { required: 'Coolant', recommended: 'Air or mist', avoid: 'Keep dry', none: 'Dry' };

/** The value next to a "Coolant" label, so it does not repeat the word. */
export const COOLANT_VALUE: Readonly<Record<CoolantNeed, string>> = { required: 'Required', recommended: 'Recommended', none: 'Not needed', avoid: 'Avoid' };
