import { expect, it } from 'vitest';
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
