/**
 * SAFETY §7: "Show this list verbatim on run.synthetos.com/safety/." The page
 * renders CANNOT_GUARANTEE, so the list must equal §7 byte for byte, in order.
 */
import { describe, expect, it } from 'vitest';
import { CANNOT_GUARANTEE } from '../src/contract.ts';
import { SAFETY_MD, cannotGuaranteeList } from './safetyDoc.ts';

describe('SAFETY §7 list', () => {
  it('equals the in-repo SAFETY.md §7 item for item, byte for byte', () => {
    const fromDoc = cannotGuaranteeList(SAFETY_MD);
    expect(fromDoc.length).toBe(11);
    expect([...CANNOT_GUARANTEE]).toEqual(fromDoc);
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(CANNOT_GUARANTEE)).toBe(true);
  });

  it('the parser notices a changed item', () => {
    const changed = SAFETY_MD.replace('10. It is not certified to any safety standard.', '10. It is certified.');
    expect(cannotGuaranteeList(changed)).not.toEqual([...CANNOT_GUARANTEE]);
  });
});
