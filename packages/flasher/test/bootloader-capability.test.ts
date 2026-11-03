/**
 * The bootloader capability (ROADMAP P0-12, T-S16). The machine guard trusts
 * it to tell a flasher-minted token from anything else, exactly once.
 */
import { describe, expect, it } from 'vitest';
import * as entry from '../src/index.ts';
import { consumeBootloaderCapability, mintBootloaderCapability } from '../src/bootloaderCapability.ts';

describe('BootloaderCapability', () => {
  it('a minted token is accepted exactly once', () => {
    const token = mintBootloaderCapability();
    expect(consumeBootloaderCapability(token)).toBe(true);
    expect(consumeBootloaderCapability(token)).toBe(false);
  });

  it('tokens are independent: consuming one leaves another valid', () => {
    const a = mintBootloaderCapability();
    const b = mintBootloaderCapability();
    expect(a).not.toBe(b);
    expect(consumeBootloaderCapability(a)).toBe(true);
    expect(consumeBootloaderCapability(b)).toBe(true);
  });

  it('refuses anything not minted here, whatever its shape', () => {
    const token = mintBootloaderCapability();
    const lookalikes: unknown[] = [
      undefined,
      null,
      0,
      'BootloaderCapability',
      Symbol('BootloaderCapability'),
      {},
      Object.freeze(Object.create(null)),
      { ...(token as object) },
      Object.create(token as object),
      [token],
      () => token,
    ];
    for (const l of lookalikes) expect(consumeBootloaderCapability(l)).toBe(false);
    // None of the lookalikes used up the real token.
    expect(consumeBootloaderCapability(token)).toBe(true);
  });

  it('a token is frozen and carries nothing', () => {
    const token = mintBootloaderCapability();
    expect(Object.isFrozen(token)).toBe(true);
    expect(Reflect.ownKeys(token)).toEqual([]);
    expect(Object.getPrototypeOf(token)).toBeNull();
  });

  it('the package entry exports the verifier but never the mint', () => {
    const names = Object.keys(entry);
    expect(names).toContain('consumeBootloaderCapability');
    expect(names.filter((n) => /mint/i.test(n))).toEqual([]);
    expect(entry.consumeBootloaderCapability).toBe(consumeBootloaderCapability);
    // Tokens come only from a FlashAuthorization, which only authorizeFlash creates (authorize.test.ts).
    expect(names).toContain('authorizeFlash');
    expect(names).not.toContain('FlashAuthorization');
  });
});
