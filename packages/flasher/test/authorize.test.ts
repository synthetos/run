/**
 * The flash gate's authorization (SAFETY H79, H85, H86, H87): the capability
 * is minted only after every check passes, once per port open, never after
 * finish().
 */
import { describe, expect, it } from 'vitest';
import type { FirmwareRelease } from '@synthetos/protocol';
import { MAX_OPENS, X192A3, authorizeFlash, consumeBootloaderCapability, sha256Hex, toIntelHex, type FlashCheck } from '../src/index.ts';

function hexText(fill = 0x11): string {
  const bytes = new Uint8Array(0x30000).fill(0xff);
  bytes.set([0x0c, 0x94, 0x00, 0x01], 0);
  bytes.fill(fill, 0x200, 0x400);
  return toIntelHex(bytes, X192A3);
}

async function release(text: string, over: Partial<FirmwareRelease> = {}): Promise<FirmwareRelease> {
  return {
    hv: 8,
    fb: 450.02,
    fv: 0.97,
    dialect: 'tinyg-en',
    part: 'x192a3',
    file: 'tinyg-450.02.hex',
    sha256: await sha256Hex(text),
    size: new TextEncoder().encode(text).length,
    date: '2026-11-03',
    changelog: 'x',
    recommended: true,
    simulatorOnly: false,
    ...over,
  };
}

async function check(over: Partial<FlashCheck> & { text?: string } = {}): Promise<FlashCheck> {
  const text = over.text ?? hexText();
  return {
    source: { kind: 'release', release: await release(text) },
    hexText: text,
    sha256: await sha256Hex(text),
    board: { id: '0084-ab', hv: 8, fb: 450.01 },
    part: X192A3,
    settingsBackup: 'saved',
    simulatedPort: false,
    ...over,
  };
}

describe('authorizeFlash', () => {
  it('authorizes a signed release for this hardware and mints one token per open, never after finish()', async () => {
    const a = await authorizeFlash(await check());
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const auth = a.authorization;
    expect(auth.image.bytes[0x200]).toBe(0x11);
    const t1 = auth.capability();
    const t2 = auth.capability();
    expect(consumeBootloaderCapability(t1)).toBe(true);
    expect(consumeBootloaderCapability(t1)).toBe(false);
    expect(consumeBootloaderCapability(t2)).toBe(true);
    expect(auth.opens).toBe(2);
    auth.finish();
    expect(auth.finished).toBe(true);
    expect(auth.capability()).toBeNull();
  });

  it('stops minting after MAX_OPENS', async () => {
    const a = await authorizeFlash(await check());
    if (!a.ok) throw new Error('not authorized');
    for (let i = 0; i < MAX_OPENS; i++) expect(a.authorization.capability()).not.toBeNull();
    expect(a.authorization.capability()).toBeNull();
  });

  it('refuses a hash or size that differs from the signed list, and a claim that does not match the text', async () => {
    const text = hexText();
    const other = hexText(0x22);
    expect(await authorizeFlash(await check({ text, source: { kind: 'release', release: await release(other) } }))).toMatchObject({ ok: false, code: 'hash-mismatch' });
    expect(await authorizeFlash(await check({ text, sha256: await sha256Hex(other) }))).toMatchObject({ ok: false, code: 'hash-mismatch' });
    expect(await authorizeFlash(await check({ text, sha256: 'nope' }))).toMatchObject({ ok: false, code: 'hash-mismatch' });
    expect(await authorizeFlash(await check({ text, source: { kind: 'release', release: await release(text, { size: 10 }) } }))).toMatchObject({ ok: false, code: 'size-mismatch' });
  });

  it('refuses the wrong hardware, a board with no hv, and a simulator image on a real port', async () => {
    const text = hexText();
    expect(await authorizeFlash(await check({ text, source: { kind: 'release', release: await release(text, { hv: 7 }) } }))).toMatchObject({ ok: false, code: 'wrong-hardware' });
    expect(await authorizeFlash(await check({ text, board: { id: 'a', hv: null, fb: null } }))).toMatchObject({ ok: false, code: 'wrong-hardware' });
    const sim = { kind: 'release' as const, release: await release(text, { simulatorOnly: true }) };
    expect(await authorizeFlash(await check({ text, source: sim }))).toMatchObject({ ok: false, code: 'simulator-image' });
    expect((await authorizeFlash(await check({ text, source: sim, simulatedPort: true }))).ok).toBe(true);
    expect(await authorizeFlash(await check({ text, source: { kind: 'release', release: { ...(await release(text)), part: 'x128a1' as 'x192a3' } } }))).toMatchObject({ ok: false, code: 'wrong-part' });
  });

  it('puts a firmware backup back only on its own board; custom firmware needs the explicit confirmation', async () => {
    expect(await authorizeFlash(await check({ source: { kind: 'backup', boardId: 'other', fb: 450.01 } }))).toMatchObject({ ok: false, code: 'not-this-board' });
    expect(await authorizeFlash(await check({ source: { kind: 'backup', boardId: 'x', fb: null }, board: { id: null, hv: 8, fb: null } }))).toMatchObject({ ok: false, code: 'not-this-board' });
    expect((await authorizeFlash(await check({ source: { kind: 'backup', boardId: '0084-ab', fb: 450.01 } }))).ok).toBe(true);
    expect(await authorizeFlash(await check({ source: { kind: 'custom', confirmed: false, name: 'mine.hex' } }))).toMatchObject({ ok: false, code: 'not-confirmed' });
    expect((await authorizeFlash(await check({ source: { kind: 'custom', confirmed: true, name: 'mine.hex' } }))).ok).toBe(true);
  });

  it('needs the settings backup first (or says the firmware cannot be read that way)', async () => {
    expect(await authorizeFlash(await check({ settingsBackup: 'missing' }))).toMatchObject({ ok: false, code: 'no-settings-backup' });
    expect((await authorizeFlash(await check({ settingsBackup: 'unreadable' }))).ok).toBe(true);
  });

  it('refuses an image the strict parser refuses, with the reason and line', async () => {
    const bad = ':020000040003F7\n:0400000001020304F2\n:00000001FF\n';
    const r = await authorizeFlash(await check({ text: bad, source: { kind: 'custom', confirmed: true, name: 'boot.hex' } }));
    expect(r).toMatchObject({ ok: false, code: 'bad-image' });
    if (!r.ok) expect(r.message).toContain('bootloader');
    const notText = await authorizeFlash({ ...(await check()), hexText: 5 as unknown as string });
    expect(notText).toMatchObject({ ok: false, code: 'bad-image' });
    const noLine = await authorizeFlash(await check({ text: ':00000001FF\n', source: { kind: 'custom', confirmed: true, name: 'x' } }));
    expect(noLine).toMatchObject({ ok: false, code: 'bad-image' });
  });
});
