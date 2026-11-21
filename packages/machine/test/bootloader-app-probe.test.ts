/**
 * The marked-board application probe (owner report 2026-11-21, TinyG v8 3Y2462-WWR at 449.01). A running TinyG is
 * silent to ESC and a bare S: it waits for a line end. After a silent AVR109 check, a marked probe may send exactly
 * one line end; a TinyG answer proves the firmware runs and hands the same port over.
 */
import { expect, it } from 'vitest';
import { X192A3 } from '@synthetos/flasher';
import { mintBootloaderCapability } from '../../flasher/src/bootloaderCapability.ts';
import { BootloaderLink } from '../src/bootloaderLink.ts';
import { FakeTransport, enc, flush } from './fakeTransport.ts';

class Wire extends FakeTransport {
  pending: ((r: IteratorResult<Uint8Array>) => void) | undefined;
  override readonly readable = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Uint8Array>>(resolve => { this.pending = resolve; }) }) };
  async send(text: string) { this.pending?.({ done: false, value: enc(text) }); await flush(); }
  override async close() { await super.close(); this.pending?.({ done: true, value: undefined }); }
}
const clock = { now: () => 0, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number, clearTimeout: (id: number) => clearTimeout(id) };
const banner = '{"r":{"fv":0.97,"fb":449.01,"hp":1,"hv":8,"id":"A","msg":"SYSTEM READY"},"f":[1,0,0]}\n';
const writes = (wire: FakeTransport) => wire.calls.filter(c => c.op === 'write').map(c => c.bytes);

async function marked(): Promise<{ wire: Wire; link: BootloaderLink }> {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3);
  await link.openProbe();
  expect(await link.checkBootloader(1)).toBe(false);
  return { wire, link };
}

it('a TinyG answer to the one line end proves the firmware: the same port is handed over, the error reply dropped', async () => {
  const { wire, link } = await marked();
  const probing = link.probeApplication(1000); await flush();
  await wire.send('{"r":{},"f":[3,102,10]}\n');
  expect(await probing).toBe(true);
  const app = link.applicationTransport();
  await app.open({ baudRate: 115200, flowControl: 'none', bufferSize: 256 });
  const next = app.readable[Symbol.asyncIterator]().next(); await wire.send('normal\n');
  expect(new TextDecoder().decode((await next).value)).toBe('normal\n');
  await app.writeLine(enc('{"id":null}\n'));
  expect(writes(wire)).toEqual(['\x1b', 'S', '\n', '{"id":null}\n']);
  expect(wire.calls.filter(c => c.op === 'open')).toHaveLength(1);
  await app.close();
});

it('a text-mode prompt (no line end) proves the firmware and stays visible to the session', async () => {
  const { wire, link } = await marked();
  const probing = link.probeApplication(1000); await flush();
  await wire.send('tinyg [mm] ok> ');
  expect(await probing).toBe(true);
  const app = link.applicationTransport();
  await app.open({ baudRate: 115200, flowControl: 'none', bufferSize: 256 });
  expect(new TextDecoder().decode((await app.readable[Symbol.asyncIterator]().next()).value)).toBe('tinyg [mm] ok> ');
  await app.close();
});

it.each([['silence', null], ["xboot's refusal", '?']])('%s keeps the quarantine: no handoff, nothing more written', async (_name, reply) => {
  const { wire, link } = await marked();
  const probing = link.probeApplication(30); await flush();
  if (reply !== null) await wire.send(reply);
  expect(await probing).toBe(false);
  expect(() => link.applicationTransport()).toThrow('banner');
  await expect(link.probeApplication(1)).rejects.toThrow('forbidden');
  await expect(link.write(enc('\n'))).rejects.toThrow('only ESC and S');
  await expect(link.finishOrdinaryPrecheck()).rejects.toThrow('forbidden');
  expect(writes(wire)).toEqual(['\x1b', 'S', '\n']);
  // A later live banner still hands over, as before, without a second line end.
  await wire.send(banner);
  expect(await link.waitForFirmwareBanner(1)).toBe(true);
  const app = await link.finishReadyPrecheck();
  await app.open({ baudRate: 115200, flowControl: 'none', bufferSize: 256 });
  const reader = app.readable[Symbol.asyncIterator]();
  expect(new TextDecoder().decode((await reader.next()).value)).toBe(banner);
  const next = reader.next(); await wire.send('after\n');
  expect(new TextDecoder().decode((await next).value)).toBe('after\n');
  expect(writes(wire)).toEqual(['\x1b', 'S', '\n']);
  await app.close();
});

it('on a link for a board found in its bootloader (it passes input on), a TinyG answer proves the firmware too', async () => {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3);
  await link.openProbe(true); expect(await link.checkBootloader(1)).toBe(false);
  const probing = link.probeApplication(1000); await flush();
  await wire.send('{"sr":{"stat":1}}\n{"r":{},"f":[3,102,10]}\ntinyg');
  expect(await probing).toBe(true);
  const app = link.applicationTransport();
  await app.open({ baudRate: 115200, flowControl: 'none', bufferSize: 256 });
  const reader = app.readable[Symbol.asyncIterator]();
  expect(new TextDecoder().decode((await reader.next()).value)).toBe('{"sr":{"stat":1}}\ntinyg');
  expect(writes(wire)).toEqual(['\x1b', 'S', '\n']);
  await app.close();
  const silent = new BootloaderLink(new Wire(), clock, X192A3);
  await silent.openProbe(true); expect(await silent.checkBootloader(1)).toBe(false);
  expect(await silent.probeApplication(5)).toBe(false);
  expect(() => silent.applicationTransport()).toThrow('banner'); await silent.close();
});

it('an ordinary link with a banner during the probe hands the banner on once', async () => {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3);
  await link.openProbe(true); expect(await link.checkBootloader(1)).toBe(false);
  const probing = link.probeApplication(1000); await flush();
  await wire.send(banner);
  expect(await probing).toBe(true);
  const app = link.applicationTransport();
  await app.open({ baudRate: 115200, flowControl: 'none', bufferSize: 256 });
  expect(new TextDecoder().decode((await app.readable[Symbol.asyncIterator]().next()).value)).toBe(banner);
  await app.close();
});

it('a banner during the probe proves the firmware, and its bytes reach the session once', async () => {
  const { wire, link } = await marked();
  const probing = link.probeApplication(1000); await flush();
  await wire.send(banner);
  expect(await probing).toBe(true);
  const app = link.applicationTransport();
  await app.open({ baudRate: 115200, flowControl: 'none', bufferSize: 256 });
  const reader = app.readable[Symbol.asyncIterator]();
  expect(new TextDecoder().decode((await reader.next()).value)).toBe(banner);
  const next = reader.next(); await wire.send('after\n');
  expect(new TextDecoder().decode((await next).value)).toBe('after\n');
  await app.close();
});

it('is refused before the AVR109 check, after a signature, on a flashing link, after a handoff, and once closed', async () => {
  const fresh = new BootloaderLink(new Wire(), clock, X192A3); await fresh.openProbe();
  await expect(fresh.probeApplication(1)).rejects.toThrow('forbidden'); await fresh.close();
  const wire = new Wire(); const found = new BootloaderLink(wire, clock, X192A3); await found.openProbe();
  const checked = found.checkBootloader(50); await flush(); await wire.send('XBoot++'); expect(await checked).toBe(true);
  await expect(found.probeApplication(1)).rejects.toThrow('forbidden'); await found.close();
  expect(writes(wire)).toEqual(['\x1b', 'S']);
  const flashing = new BootloaderLink(new Wire(), clock, X192A3); await flashing.open(mintBootloaderCapability());
  await expect(flashing.probeApplication(1)).rejects.toThrow('forbidden'); await flashing.close();
  const handed = new Wire(); const ready = new BootloaderLink(handed, clock, X192A3); await ready.openProbe();
  expect(await ready.checkBootloader(1)).toBe(false); await handed.send(banner); ready.applicationTransport();
  await expect(ready.probeApplication(1)).rejects.toThrow('forbidden'); await ready.close();
  const failed = await marked(); failed.wire.writeError = new Error('no'); await expect(failed.link.probeApplication(1)).rejects.toThrow('no');
  await expect(failed.link.probeApplication(1)).rejects.toThrow('forbidden'); await failed.link.close();
  const closed = await marked(); await closed.link.close();
  await expect(closed.link.probeApplication(1)).rejects.toThrow('forbidden');
});

it('a failed line end ends the link: nothing more is written', async () => {
  const { wire, link } = await marked();
  wire.writeError = new Error('line end failed');
  await expect(link.probeApplication(1000)).rejects.toThrow('line end failed');
  await expect(link.checkBootloader(1)).rejects.toThrow();
  await link.close();
});

it('the link closing during the probe proves nothing', async () => {
  const { wire, link } = await marked();
  const probing = link.probeApplication(1000); await flush();
  wire.drop();
  expect(await probing).toBe(false);
  await link.close();
});
