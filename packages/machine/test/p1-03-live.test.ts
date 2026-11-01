/**
 * ROADMAP P1-03 against the test-kit firmware models (live-shaped
 * transcripts: the real session, the real link timing, the models' own
 * answers): T-S55 (classification), T-S86 (first line and splice), T-S60
 * (ORPHANED_MOTION), `ex` = 2 → READ_ONLY, and the probe result in the
 * session log. A "previous sender" is the test writing to the model before
 * the session connects, as another program would have.
 *
 * The bench halves are HIL-1.1, HIL-1.2, HIL-1.10, HIL-1.12 and B-PROBE-1.
 */
import type { ApprovedBuilds } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { harness, type Harness, type ModelName } from './sessionHarness.ts';
import { PORT, shown } from './simTransport.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

const enc = new TextEncoder();

/** Another program writing to the board before this session connects. */
function previousSender(h: Harness, text: string): void {
  h.endpoint.hostWrite(enc.encode(text));
}

async function connect(h: Harness, ms = 6000): Promise<string[]> {
  void h.session.connect(PORT);
  await h.run(ms);
  return (h.transports.at(-1)?.writes ?? []).map(shown);
}

function make(model: ModelName, manifest?: ApprovedBuilds, start: 'ready' | 'boot' = 'ready'): Harness {
  return harness(model, { device: { start, bootMs: 200 }, session: manifest === undefined ? {} : { manifest } });
}

describe('T-S55 against live-shaped transcripts (the models answer the probe)', () => {
  it('edge-next: tinyg-en, READ_ONLY without an approval, full with one; booting or already powered', async () => {
    for (const start of ['ready', 'boot'] as const) {
      const h = make('en', undefined, start);
      const writes = await connect(h);
      expect(writes[0]).toBe('{"sr":null}\\n');
      expect(h.session.snapshot.classification, start).toMatchObject({ dialectId: 'tinyg-en', mode: 'readOnly', reason: 'en-not-approved' });
      expect(h.session.snapshot.overlays).toEqual(['READ_ONLY']);

      const a = make('en', EN_APPROVED, start);
      await connect(a);
      expect(a.session.snapshot.classification, start).toMatchObject({ dialectId: 'tinyg-en', mode: 'full', reason: 'en-approved' });
      expect(a.session.snapshot.overlays).toEqual([]);
      expect(a.session.snapshot.base).toBe('CONNECTED_UNKNOWN');
    }
  });

  it('440.21: tinyg-440 READ_ONLY (no approval until D22), with the upgrade offer', async () => {
    const h = make('440');
    const writes = await connect(h);
    expect(writes[0]).toBe('{"sr":null}\\n');
    expect(h.session.snapshot.classification).toMatchObject({ dialectId: 'tinyg-440', mode: 'readOnly', reason: 'tg440-not-approved', upgradeOffer: true });
    // An edge-next approval for fb 450.01 does not approve a 440.21 board.
    const a = make('440', EN_APPROVED);
    await connect(a);
    expect(a.session.snapshot.classification).toMatchObject({ dialectId: 'tinyg-440', mode: 'readOnly' });
  });

  it('the probe result is in the session log, with the verdict', async () => {
    const h = make('en');
    await connect(h);
    const notes = h.session.log().filter((e) => e.dir === 'note' && e.text.startsWith('probe: '));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toContain('"fb":450.01');
    expect(notes[0]?.text).toContain('→ tinyg-en read-only (en-not-approved)');
  });
});

describe('ex = 2 (RTS/CTS) → READ_ONLY (PN §5.3)', () => {
  it('an approved edge-next whose flow control was set to RTS/CTS by another program is READ_ONLY', async () => {
    const h = make('en', EN_APPROVED);
    previousSender(h, '{"ex":2}\n');
    await h.run(500);
    await connect(h);
    expect(h.session.snapshot.classification).toMatchObject({ dialectId: 'tinyg-en', mode: 'readOnly', reason: 'flowControl' });
    expect(h.session.snapshot.overlays).toContain('READ_ONLY');
    expect(h.session.log().some((e) => e.dir === 'note' && e.text === 'classification: read-only, flow control (ex) is 2 (RTS/CTS)')).toBe(true);
  });
});

describe('T-S86 (live): a partial line left by a previous sender never runs', () => {
  for (const model of ['en', '440'] as const) {
    it(`${model}: the first line is {"sr":null}; the spliced G0 does not move the machine`, async () => {
      const h = make(model);
      previousSender(h, 'G0 X1');
      await h.run(200);
      const writes = await connect(h);
      expect(writes[0]).toBe('{"sr":null}\\n');
      const snap = h.device.snapshot();
      expect(snap.position.every((v) => v === 0)).toBe(true);
      expect(snap.machineState).not.toMatch(/run|cycle/i);
      // The board answered the spliced first line with an error status (the fragment did not parse as G-code).
      expect(h.session.log().find((e) => e.dir === 'rx')?.text).toMatch(model === 'en' ? /"f":\[3,[1-9]\d*,/ : /"f":\[1,[1-9]\d*,/);
      expect(h.session.snapshot.classification?.dialectId).toBe(model === 'en' ? 'tinyg-en' : 'tinyg-440');
      expect(h.session.snapshot.overlays).not.toContain('ORPHANED_MOTION');
    });
  }
});

describe('T-S60 (live): a board left busy by a previous session is ORPHANED_MOTION, never just READ_ONLY', () => {
  const busy: readonly { readonly name: string; readonly sender: readonly string[] }[] = [
    { name: 'held with a queue', sender: ['G1 X20 F200\nG1 X40\nG1 X60\n', '!'] },
    { name: 'moving', sender: ['G1 X200 F100\n'] },
  ];
  for (const model of ['en', '440'] as const) {
    for (const { name, sender } of busy) {
      it(`${model}, ${name}: ORPHANED_MOTION; only ! is written; ~ never`, async () => {
        const h = make(model, model === 'en' ? EN_APPROVED : undefined);
        for (const text of sender) {
          previousSender(h, text);
          await h.run(400);
        }
        // The previous session really left the board busy.
        const before = h.device.snapshot();
        expect(before.position.some((v) => v !== 0)).toBe(true);
        if (sender.includes('!')) expect(before.hold).not.toBe(0);
        await connect(h, 4000);
        const snap = h.session.snapshot;
        expect(snap.overlays).toContain('ORPHANED_MOTION');
        // Pause is offered; resume, jog and the rest are not.
        expect(h.session.feedhold()).toEqual({ allowed: true });
        for (const intent of ['resume', 'jog', 'home', 'start', 'settingsWrite', 'consoleLine'] as const) {
          expect(h.session.request({ intent } as never), intent).toMatchObject({ allowed: false });
        }
        await h.run(100);
        const bytes = (h.transports.at(-1)?.writes ?? []).flatMap((w) => [...w]);
        expect(bytes).not.toContain(0x7e);
        expect(bytes).not.toContain(0x18);
        expect(bytes).not.toContain(0x04);
        for (const w of h.transports.at(-1)?.writes ?? []) {
          const text = shown(w);
          expect(text === '!' || text === '\\x05' || /^\{"[a-z0-9]+":null\}\\n$/.test(text), text).toBe(true);
        }
      });
    }
  }
});
