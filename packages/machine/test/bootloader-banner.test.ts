import { expect, it } from 'vitest';
import { mintBootloaderCapability } from '../../flasher/src/bootloaderCapability.ts';
import { X192A3 } from '@synthetos/flasher';
import { BootloaderLink } from '../src/bootloaderLink.ts';
import { FakeTransport, enc, flush } from './fakeTransport.ts';

class Wire extends FakeTransport {
  pending: ((r: IteratorResult<Uint8Array>) => void) | undefined;
  override readonly readable = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Uint8Array>>(resolve => { this.pending = resolve; }) }) };
  async send(text: string) { this.pending?.({ done: false, value: enc(text) }); await flush(); }
  override async close() { await super.close(); this.pending?.({ done: true, value: undefined }); }
}
const clock = { now: () => 0, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number, clearTimeout: (id: number) => clearTimeout(id) };
const banner = '{"sr":{"fv":0.97,"fb":450.02,"hp":1,"hv":8,"id":"A","msg":"SYSTEM READY"}}\n';

it('probe permits only ESC/S; only a fresh complete ready banner allows same-port handoff', async () => {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3);
  expect(() => link.applicationTransport()).toThrow('banner');
  await link.openProbe();
  await expect(link.openProbe()).rejects.toThrow('already');
  for (const text of ['E', 'e', 'll', '{sr:null}\n', '\x18', '\x11', '\x05']) await expect(link.write(enc(text))).rejects.toThrow('only ESC and S');
  await link.write(enc('\x1b')); await link.write(enc('S'));
  await wire.send('XBoot++\n{"r":{"fb":450.02}}\n');
  await expect(link.waitForFirmwareBanner(1)).resolves.toBe(false);
  await wire.send(banner.replace('SYSTEM READY', 'Loading configs'));
  expect(link.firmwareBanner).toBeNull();
  await wire.send(banner.slice(0, 30));
  expect(link.firmwareBanner).toBeNull();
  const ready = link.waitForFirmwareBanner(100);
  await wire.send(banner.slice(30));
  await expect(ready).resolves.toBe(true);
  await expect(link.waitForFirmwareBanner(1)).resolves.toBe(true);
  await expect(link.write(enc('S'))).rejects.toThrow('firmware has started');
  const app = link.applicationTransport();
  expect(() => link.applicationTransport()).toThrow('handoff');
  await expect(app.writeLine(enc('{}\n'))).rejects.toThrow('closed');
  await expect(app.open({ baudRate: 9600, flowControl: 'none', bufferSize: 256 })).rejects.toThrow('invalid');
  await app.open({ baudRate: 115200, flowControl: 'none', bufferSize: 256 });
  const reader = app.readable[Symbol.asyncIterator]();
  expect(new TextDecoder().decode((await reader.next()).value)).toBe(banner);
  const next = reader.next(); await wire.send('answer\n');
  expect(new TextDecoder().decode((await next).value)).toBe('answer\n');
  await app.writeLine(enc('{sr:null}\n'));
  expect(wire.calls.filter(c => c.op === 'open')).toHaveLength(1);
  let dropped = false; app.onDisconnect(() => { dropped = true; });
  const end = reader.next(); await app.close(); expect((await end).done).toBe(true); expect(dropped).toBe(true);
});

it('a dropped link, malformed or overlong line never supplies banner proof', async () => {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3);
  await link.openProbe();
  await wire.send('x'.repeat(2100) + '\n{bad}\n');
  expect(link.firmwareBanner).toBeNull();
  const waiting = link.waitForFirmwareBanner(1000); wire.drop();
  await expect(waiting).resolves.toBe(false);
  expect(() => link.applicationTransport()).toThrow('banner'); await link.close();
});

it('bounds buffered application bytes and closes the handoff after a failed application write', async () => {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3);
  await link.openProbe(); await wire.send(banner);
  const app = link.applicationTransport(); expect(app.info()).toEqual(wire.info());
  await app.open({ baudRate: 115200, flowControl: 'none', bufferSize: 256 });
  wire.writeError = new Error('partial write');
  await expect(app.writeLine(enc('{}\n'))).rejects.toThrow('partial write');
  wire.writeError = undefined;
  await expect(app.writeLine(enc('{}\n'))).rejects.toThrow('closed');
  await wire.send('x'.repeat(65537));
  expect(link.closed).toBe(true); await link.close();
});

it('recognises the protocol parser’s verbosity-filtered ready banner', async () => {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3);
  await link.openProbe(); await wire.send('{"r":{"fv":0.97,"fb":440.21,"hp":1,"hv":8,"id":"A"},"f":[1,0,0]}\n');
  expect(link.firmwareBanner?.fb).toBe(440.21); await link.close();
});

it('ordinary pre-check recognises a signature after unrelated bytes and permits only an explicit start', async () => {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3);
  await link.openProbe(true);
  const check = link.checkBootloader(100); await flush(); await wire.send('noiseXBoot++');
  expect(await check).toBe(true);
  await expect(link.finishOrdinaryPrecheck()).rejects.toThrow('forbidden');
  await expect(link.write(enc('E'))).rejects.toThrow('only ESC and S');
  await link.startFirmware();
  expect(wire.calls.filter(c => c.op === 'write').map(c => c.bytes)).toEqual(['\x1b', 'S', 'E']);
  await wire.send('\r' + banner);
  expect(await link.waitForFirmwareBanner(1)).toBe(true); await link.close();
});
it('ordinary pre-check consumes one error, then hands over without reopening; quarantine cannot use either escape', async () => {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3);
  await link.openProbe(true); expect(await link.checkBootloader(1)).toBe(false);
  await expect(link.startFirmware()).rejects.toThrow('forbidden');
  const fallback = link.finishOrdinaryPrecheck(); await flush(); await wire.send('{"r":{},"f":[3,102,10]}\n');
  const app = await fallback; await app.open({ baudRate: 115200, flowControl: 'none', bufferSize: 256 });
  const next = app.readable[Symbol.asyncIterator]().next(); await wire.send('normal\n');
  expect(new TextDecoder().decode((await next).value)).toBe('normal\n');
  expect(wire.calls.filter(c => c.op === 'write').map(c => c.bytes)).toEqual(['\x1b', 'S', '\n']);
  await app.close();
  const quarantined = new BootloaderLink(new Wire(), clock, X192A3); await quarantined.openProbe();
  await expect(quarantined.finishOrdinaryPrecheck()).rejects.toThrow('forbidden');
  await expect(quarantined.startFirmware()).rejects.toThrow('forbidden'); await quarantined.close();
});

it('keeps a ready banner and following report once on an ordinary pre-check', async () => {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3); await link.openProbe(true);
  const checked = link.checkBootloader(5); await flush(); await wire.send(banner); await wire.send('report\n');
  expect(await checked).toBe(false);
  const fallback = link.finishOrdinaryPrecheck(); await flush(); await wire.send('{"r":{},"f":[3,102,10]}\n');
  const app = await fallback; await app.open({ baudRate: 115200, flowControl: 'none', bufferSize: 256 });
  const reader = app.readable[Symbol.asyncIterator]();
  expect(new TextDecoder().decode((await reader.next()).value)).toBe(banner);
  expect(new TextDecoder().decode((await reader.next()).value)).toBe('report\n'); await app.close();
});
it('a failed newline or dropped link cannot unlock the ordinary probe', async () => {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3); await link.openProbe(true);
  expect(await link.checkBootloader(1)).toBe(false); wire.writeError = new Error('newline failed');
  await expect(link.finishOrdinaryPrecheck()).rejects.toThrow('newline failed');
  await expect(link.checkBootloader(1)).rejects.toThrow(); await link.close();
  await expect(link.checkBootloader(1)).rejects.toThrow();
});

it('promotes an identified probe only with a fresh flash capability', async () => {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3); await link.openProbe(true);
  await expect(link.finishOrdinaryPrecheck()).rejects.toThrow('forbidden');
  await expect(link.finishReadyPrecheck()).rejects.toThrow('banner');
  expect(() => link.authorizeUpdate(mintBootloaderCapability())).toThrow('identified');
  const checked = link.checkBootloader(50); await flush(); await wire.send('XBoot++'); expect(await checked).toBe(true);
  expect(() => link.authorizeUpdate(undefined)).toThrow('capability');
  const token = mintBootloaderCapability(); link.authorizeUpdate(token);
  expect(() => link.authorizeUpdate(token)).toThrow('capability');
  await link.write(enc('V')); await link.close();
});

it('a quarantined probe finishes its bare S only after a fresh ready banner, then hands off the same port', async () => {
  const wire = new Wire(); const link = new BootloaderLink(wire, clock, X192A3);
  await link.openProbe();
  expect(await link.checkBootloader(1)).toBe(false);
  await expect(link.finishReadyPrecheck()).rejects.toThrow('banner');
  await wire.send(banner);
  const finishing = link.finishReadyPrecheck();
  await flush();
  await wire.send('{"r":{},"f":[3,102,10]}\n');
  const app = await finishing;
  expect(wire.calls.filter(c => c.op === 'open')).toHaveLength(1);
  expect(() => link.applicationTransport()).toThrow('handoff');
  await app.close();
});
