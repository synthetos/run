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
      expect(writes[0]).toBe('{sr:null}\\n');
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
    expect(writes[0]).toBe('{sr:null}\\n');
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

/**
 * A partial line left in the board's buffer by another program, then a gap, then this session's
 * `{sr:null}` (bench 2, 2026-11-02; PROTOCOL_NOTES §2.3a; TinyG HIL diagnostic
 * test_leftover_line_reconnect, edge-next d254eb0b and 440.21 d0418390). The fragment and the guard
 * line join into one line. The test-kit models reproduce every measured row.
 *
 * | fragment          | edge-next      | 440.21         |
 * | `G0 X0.5`         | rejected (101) | rejected (102) |
 * | `G0 X0.`          | rejected (101) | rejected (102) |
 * | `G0 X0.5 (rough`  | RUNS, status 0 | RUNS, status 0 |
 * | `G0 X0.5 ;rough`  | RUNS, status 0 | RUNS, status 0 |
 *
 * In every row the answer to the guard line is a G-code reply (`{"r":{},"f":[...]}`) with no `sr`
 * key, so the session classifies ORPHANED_MOTION: only `!` (and "Use your E-stop") from then on.
 */
describe('T-S86 (live): a leftover partial line joins {sr:null}; the G-code answer (no "sr") is ORPHANED_MOTION', () => {
  const ROWS = [
    { fragment: 'G0 X0.5', runs: false },
    { fragment: 'G0 X0.', runs: false },
    { fragment: 'G0 X0.5 (rough', runs: true },
    { fragment: 'G0 X0.5 ;rough', runs: true },
  ] as const;
  for (const model of ['en', '440'] as const) {
    for (const { fragment, runs } of ROWS) {
      it(`${model}: "${fragment}" + {sr:null} ${runs ? 'RUNS on the board' : 'is rejected'}; the session stops at ORPHANED_MOTION and writes nothing else`, async () => {
        const h = make(model, model === 'en' ? EN_APPROVED : undefined);
        previousSender(h, fragment);
        await h.run(500);
        const writes = await connect(h);
        expect(writes).toEqual(['{sr:null}\\n']);
        const reply = h.session.log().find((e) => e.dir === 'rx')?.text ?? '';
        expect(reply).not.toContain('"sr"');
        expect(reply).toMatch(runs ? /"f":\[[13],0,/ : model === 'en' ? /"f":\[3,101,/ : /"f":\[1,102,/);
        const x = h.device.snapshot().position[0] as number;
        expect(x).toBeCloseTo(runs ? 0.5 : 0, 3);
        const snap = h.session.snapshot;
        expect(snap.overlays).toContain('ORPHANED_MOTION');
        expect(snap.classification).toBeNull();
        expect(h.session.log().some((e) => e.dir === 'note' && e.text.includes('answered as G-code (no "sr" key'))).toBe(true);
        // Only stop-class bytes are offered now: Pause writes `!`, and nothing that ends a line follows.
        expect(h.session.feedhold()).toMatchObject({ allowed: true });
        await h.run(200);
        expect((h.transports.at(-1)?.writes ?? []).map(shown)).toEqual(['{sr:null}\\n', '!']);
      });
    }
  }

  it('a clean buffer still answers {sr:null} with "sr": no ORPHANED_MOTION', async () => {
    const h = make('en');
    await connect(h);
    expect(h.session.log().find((e) => e.dir === 'rx')?.text).toContain('"sr"');
    expect(h.session.snapshot.overlays).not.toContain('ORPHANED_MOTION');
  });
});

describe('T-S60 (live): a held board whose probe answer arrives damaged is ORPHANED_MOTION, not just READ_ONLY', () => {
  const HELD = ['G1 X20 F200\nG1 X40\nG1 X60\n', '!'];
  async function heldThenConnect(h: Harness): Promise<void> {
    for (const text of HELD) {
      previousSender(h, text);
      await h.run(400);
    }
    await connect(h, 4000);
  }

  it('en: the hp answer is damaged on the wire; the session is unclassified and ORPHANED_MOTION', async () => {
    // A clean run of the same deterministic scenario locates the hp answer among the bytes to the host.
    const clean = make('en', EN_APPROVED);
    await heldThenConnect(clean);
    expect(clean.session.snapshot.overlays).toContain('ORPHANED_MOTION');
    const text = new TextDecoder().decode(clean.endpoint.transcript.bytesOf('host-read'));
    const at = text.indexOf('{"r":{"hp"');
    expect(at).toBeGreaterThan(0);

    const h = harness('en', { device: { start: 'ready', bootMs: 200 }, session: { manifest: EN_APPROVED }, faults: { faults: [{ kind: 'drop', direction: 'toHost', select: { at: [at + 4] } }] } });
    await heldThenConnect(h);
    expect(h.device.snapshot().hold).not.toBe(0);
    const snap = h.session.snapshot;
    expect(snap.classification).toMatchObject({ dialectId: null, reason: 'probeFailed' });
    expect(snap.overlays).toContain('ORPHANED_MOTION');
    expect((h.transports.at(-1)?.writes ?? []).map(shown)).not.toContain('~');
  });
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
          expect(text === '!' || text === '\\x05' || /^\{"?[a-z0-9]+"?:null\}\\n$/.test(text), text).toBe(true);
        }
      });
    }
  }
});

/**
 * Bench 1, 2026-11-02 (hotfix): the owner connected right after the firmware maintainer's harness had run
 * moves on edge-next 450.01 (feed-limit build 50659c90). Nothing was queued or held: the last report was
 * {"sr":{"stat":3}} (cycle end finalizes to PROGRAM_STOP, @cite EN canonical_machine.c cm_cycle_end), then the
 * harness restored ex, qv, si and the jerk settings and disconnected. READING then read stat 3, hold 0,
 * vel 0, qr 32, and the session showed ORPHANED_MOTION because only stat 1 and 4 counted as resting.
 * A program pause (M0) on edge-next is stat 3 **with hold 6**, and that must still be ORPHANED_MOTION.
 */
describe('T-S60 (live): stat 3 after a finished cycle is resting on edge-next; a program pause is not', () => {
  async function maintainerRun(h: Harness, tail: readonly string[]): Promise<void> {
    for (const text of ['{"ex":1}\n', 'G1 X5 F600\n', ...tail]) {
      previousSender(h, text);
      await h.run(400);
    }
    await h.run(2000);
  }

  it('en: moves finished (stat 3, hold 0, planner empty), settings restored: no ORPHANED_MOTION', async () => {
    const h = make('en', EN_APPROVED);
    await maintainerRun(h, ['{"qv":0}\n', '{"si":100}\n', '{"xjm":20}\n', '{"yjm":20}\n', '{"zjm":20}\n']);
    const before = h.device.snapshot();
    expect(before.stat).toBe(3);
    expect(before.hold).toBe(0);
    expect(before.velocity).toBe(0);
    await connect(h);
    const snap = h.session.snapshot;
    expect(snap.live.stat).toBe(3);
    expect(snap.live.qr).toBe(32);
    expect(snap.overlays).not.toContain('ORPHANED_MOTION');
    expect(snap.overlays).toEqual([]);
  });

  it('en: a program pause (M0: stat 3, hold 6) left by the previous sender is still ORPHANED_MOTION', async () => {
    const h = make('en', EN_APPROVED);
    await maintainerRun(h, ['M0\n']);
    const before = h.device.snapshot();
    expect(before.stat).toBe(3);
    expect(before.hold).not.toBe(0);
    await connect(h);
    expect(h.session.snapshot.overlays).toContain('ORPHANED_MOTION');
  });

  it('440: stat 3 stays not resting (hold is unverified on 440.21, so a program stop cannot be told apart)', async () => {
    const h = make('440');
    await maintainerRun(h, []);
    expect(h.device.snapshot().stat).toBe(3);
    await connect(h);
    expect(h.session.snapshot.overlays).toContain('ORPHANED_MOTION');
  });

  it('the spindle and coolant poll never asks anything before identification and READING are done', async () => {
    const h = make('en', EN_APPROVED);
    await maintainerRun(h, []);
    void h.session.connect(PORT);
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      await h.run(100);
      const base = h.session.snapshot.base;
      const writes = (h.transports.at(-1)?.writes ?? []).map(shown);
      if (base === 'IDENTIFYING' || base === 'READING' || base === 'OPENING') {
        for (const w of writes) expect(w, `${base}: ${w}`).not.toMatch(/"?(spe|spc|sps|cof|com|mpo)"?:null/);
      }
      seen.push(base);
    }
    expect(seen).toContain('CONNECTED_UNKNOWN');
  });
});
