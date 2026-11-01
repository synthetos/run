/**
 * The models are written independently of @synthetos/protocol, so the
 * protocol decoder can check them and they can check it: everything a model
 * prints in a normal session must decode as a well-formed event of the kind
 * its dialect expects (banner shape, footer revision, checksum), never as
 * Garbled.
 */
import { describe, expect, it } from 'vitest';
import { TINYG_440, TINYG_EN, decodeInbound } from '@synthetos/protocol';
import { enSim, tgSim } from './helpers.ts';

const SESSION = ['{"sr":null}', '{"fb":null}', '{"fv":null}', '{"hp":null}', '{"id":null}', 'M3 S100', 'G1 X3 F600', 'G4 P0.1', 'M5', '{"qr":null}', '{"stat":null}'];

describe('model output decodes with @synthetos/protocol', () => {
  it('edge-next: bare-sr banners, footer revision 3 responses, ENQ ack, no Garbled', () => {
    const sim = enSim({ start: 'boot' });
    sim.clock.advance(1100);
    for (const l of SESSION) sim.host.sendLine(l);
    sim.host.send('\x05');
    sim.host.sendLine('{"spph":null}');
    sim.clock.advance(1500);
    const events = decodeInbound([sim.endpoint.transcript.bytesOf('host-read')]);
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.has('Garbled')).toBe(false);
    const banners = events.filter((e) => e.kind === 'Banner');
    expect(banners.map((b) => (b.kind === 'Banner' ? [b.shape, b.ready, b.fb] : []))).toEqual([
      ['bare-sr', false, 450.01],
      ['bare-sr', true, 450.01],
    ]);
    expect(TINYG_EN.bannerShape).toBe('bare-sr');
    const responses = events.flatMap((e) => (e.kind === 'Response' ? [e] : []));
    expect(responses.length).toBe(SESSION.length + 1);
    expect(new Set(responses.map((r) => r.footer.rev))).toEqual(new Set([3]));
    expect(TINYG_EN.caps.footerRevs).toContain(3);
    expect(kinds.has('Ack')).toBe(true);
    expect(kinds.has('StatusReport')).toBe(true);
    expect(responses.at(-1)?.footer.status).toBe(17); // spph stubbed, as the classifier expects
  });

  it('440.21: r-footer banners and revision-1 responses whose checksums verify', () => {
    const sim = tgSim({ start: 'boot' });
    sim.clock.advance(1100);
    for (const l of SESSION) sim.host.sendLine(l);
    sim.host.sendLine('{"spph":null}');
    sim.clock.advance(1500);
    const events = decodeInbound([sim.endpoint.transcript.bytesOf('host-read')]);
    expect(events.filter((e) => e.kind === 'Garbled')).toEqual([]);
    const banners = events.flatMap((e) => (e.kind === 'Banner' ? [e] : []));
    expect(banners.map((b) => [b.shape, b.ready])).toEqual([
      ['r-footer', false],
      ['r-footer', true],
    ]);
    expect(TINYG_440.bannerShape).toBe('r-footer');
    const responses = events.flatMap((e) => (e.kind === 'Response' ? [e] : []));
    expect(responses.length).toBe(SESSION.length + 1);
    for (const r of responses) {
      expect(r.footer.rev).toBe(1);
      expect(r.footer.checksum).toBeDefined(); // a wrong checksum would have made it Garbled
    }
    expect(responses.at(-1)?.footer.status).toBe(100); // no spph on 440.21
  });
});
