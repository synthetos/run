/**
 * The read-only session reducer (ROADMAP P1-02): the connection path, every
 * overlay, the Phase 1 allow-matrix, and the safety tests that live at this
 * layer: T-S10 (both banner shapes), T-S21 (device id mismatch), T-S26 and
 * T-S24a (no 0x18 or 0x04 in any effect, generated over states × events),
 * T-S3 (the matrix decides every intent first).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BYTE, PROBE_STEPS, TINYG_EN, classifyLine, type ApprovedBuilds, type Inbound } from '@synthetos/protocol';
import { CURRENT_RELEASE, INTENTS, OVERLAYS, allowed, type Intent } from '@synthetos/safety';
import { isReadAllowed } from '@synthetos/schema';
import { DEFAULT_TIMINGS, MAX_PROBE_RESTARTS, MAX_QUEUED_READS, READING_TOKENS, SEED_TOKENS, enqAllowedNow, matrixSnapshot, readableNow, type SessionEffect, type SessionIntent } from '../src/index.ts';
import { Driver, EN_ANSWERS, EN_BOOT_BANNER, EN_READY_BANNER, SIM_INFO, TG_ANSWERS, TG_READY_BANNER, tg } from './sessionDriver.ts';
import { PORT } from './simTransport.ts';

/** A manifest that approves the scripted edge-next build, so the session is classified full (ENQ allowed). */
const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

const PROBE_LINES = PROBE_STEPS.map((s) => s.line);
const READING_LINES = READING_TOKENS.map((t) => `{"${t}":null}`);
/** The connect-time state read after READING (amendment 2026-11-02), through each dialect's allowlist. */
const seedLines = (dialect: string): string[] => SEED_TOKENS.filter((t) => isReadAllowed(dialect, t)).map((t) => `{"${t}":null}`);
const EN_CONNECT = [...PROBE_LINES, ...READING_LINES, ...seedLines('tinyg-en')];
/** Values the connect-time read left in state.values. */
const seedValues = (d: Driver): Record<string, unknown> => Object.fromEntries(Object.entries(d.state.values).filter(([k]) => !SEED_TOKENS.includes(k)));

function connected(answers = EN_ANSWERS, options: ConstructorParameters<typeof Driver>[0] = {}, expected: string | null = null): Driver {
  const d = new Driver(options);
  d.open(expected);
  d.answer(answers);
  return d;
}

const realtime = (effects: readonly SessionEffect[]): number[] =>
  effects.filter((e) => e.kind === 'writeRealtime').map((e) => (e as Extract<SessionEffect, { kind: 'writeRealtime' }>).byte);

describe('intents through the allow-matrix (T-S3) and the Phase 1 session', () => {
  it('Pause, Stop job and Spindle off write only ! (Phase 1 / READ_ONLY: "Use your E-stop" for the last two)', () => {
    const d = connected(EN_ANSWERS, { manifest: EN_APPROVED });
    d.at = 42;
    expect(d.intent({ intent: 'feedhold' })).toEqual({ allowed: true });
    expect(d.state.notices).toEqual({ pauseRequestedAt: 42, adviseEstop: false });
    d.intent({ intent: 'stopJob' });
    d.intent({ intent: 'spindleOffNow' });
    d.intent({ intent: 'feedhold' });
    expect(d.realtime()).toEqual([BYTE.FEEDHOLD, BYTE.FEEDHOLD, BYTE.FEEDHOLD, BYTE.FEEDHOLD]);
    expect(d.state.notices.adviseEstop).toBe(true);
    expect(d.state.sent).toEqual({ lines: EN_CONNECT.length, realtime: 4 });
  });

  it('feedhold is the unclassified ! while identifying, and denied before the port opens', () => {
    const d = new Driver();
    expect(d.intent({ intent: 'feedhold' }).allowed).toBe(false);
    d.intent({ intent: 'connect', port: PORT, expectedDeviceId: null });
    expect(d.intent({ intent: 'feedhold' }).allowed).toBe(false);
    d.feed({ type: 'transportAcquired', epoch: 1 });
    d.feed({ type: 'opened', epoch: 1, info: SIM_INFO });
    expect(d.intent({ intent: 'feedhold' })).toEqual({ allowed: true });
    expect(d.realtime()).toEqual([0x21]);
  });

  it('ENQ: only classified edge-next after a rev-2/3 footer, at most one outstanding; {"ack":true} clears it', () => {
    const d = new Driver({ manifest: EN_APPROVED });
    d.open();
    expect(d.intent({ intent: 'enq' }).allowed).toBe(false);
    d.answer(EN_ANSWERS);
    expect(enqAllowedNow(d.state)).toBe(true);
    expect(d.intent({ intent: 'enq' })).toEqual({ allowed: true });
    expect(d.realtime()).toEqual([BYTE.ENQ]);
    expect(d.intent({ intent: 'enq' })).toMatchObject({ allowed: false, reason: 'A liveness probe is already outstanding.' });
    d.at = 77;
    d.line('{"ack":true}');
    expect(d.state).toMatchObject({ enqOutstanding: false, lastAckAt: 77 });
    expect(d.intent({ intent: 'enq' })).toEqual({ allowed: true });
  });

  it('ENQ is never sent to 440.21 (no ENQ in its dialect, rev-1 footers)', () => {
    const d = connected(TG_ANSWERS);
    expect(d.intent({ intent: 'enq' }).allowed).toBe(false);
    expect(enqAllowedNow(d.state)).toBe(false);
    expect(d.realtime()).toEqual([]);
  });

  it('ENQ needs the rev-2/3 footer even on a classified edge-next state', () => {
    const d = connected(EN_ANSWERS, { manifest: EN_APPROVED });
    d.state = { ...d.state, footerRev: 1 };
    expect(enqAllowedNow(d.state)).toBe(false);
    expect(d.intent({ intent: 'enq' })).toMatchObject({ allowed: false, citation: 'SAFETY §4.1 Liveness probe row; T-S24b; PN §2.3' });
  });

  it('read: only classified, only allowlisted, bounded, de-duplicated; values land in state.values', () => {
    const d = connected();
    expect(d.intent({ intent: 'read', tokens: [] })).toMatchObject({ allowed: false, reason: 'Nothing to read.' });
    expect(d.intent({ intent: 'read', tokens: 'posx' as unknown as string[] })).toMatchObject({ allowed: false });
    expect(d.intent({ intent: 'read', tokens: ['posx', 'md', 7 as unknown as string] })).toMatchObject({ allowed: false, reason: 'Not on the tinyg-en read allowlist: "md", "7".' });
    expect(d.intent({ intent: 'read', tokens: ['posx', 'posx', 'mpox'] })).toEqual({ allowed: true });
    expect(d.intent({ intent: 'read', tokens: ['mpox'] })).toEqual({ allowed: true });
    d.answer(EN_ANSWERS);
    expect(d.lines().slice(-2)).toEqual(['{"posx":null}', '{"mpox":null}']);
    expect(seedValues(d)).toEqual({ posx: { value: 1.5, status: 0, at: 0 }, mpox: { value: 2.5, status: 0, at: 0 } });
    const many = Array.from({ length: MAX_QUEUED_READS + 1 }, (_, i) => ['posx', 'posy', 'posz', 'mpox', 'mpoy', 'mpoz'][i % 6] as string);
    expect(d.intent({ intent: 'read', tokens: many })).toEqual({ allowed: true });
    const allowlisted = ['xvm', 'yvm', 'zvm', 'avm', 'bvm', 'cvm', 'xfr', 'yfr', 'zfr', 'afr', 'bfr', 'cfr'].filter((t) => isReadAllowed('tinyg-en', t));
    const flood = [...allowlisted, ...['1ma', '2ma', '3ma', '4ma', '1sa', '2sa', '3sa', '4sa', '1tr', '2tr', '3tr', '4tr', '1mi', '2mi', '3mi', '4mi', '1po', '2po', '3po', '4po', '1pm', '2pm', '3pm', '4pm']];
    const d2 = connected();
    const first = flood.slice(0, MAX_QUEUED_READS - 2);
    expect(first.every((t) => isReadAllowed('tinyg-en', t))).toBe(true);
    void first;
    d2.state = { ...d2.state, queue: Array.from({ length: MAX_QUEUED_READS }, () => ({ token: 'posx', purpose: 'reading' as const })) };
    expect(d2.intent({ intent: 'read', tokens: ['mpox'] })).toMatchObject({ allowed: false, reason: 'Too many reads are waiting.' });
  });

  it('a read answered with an error status is recorded with its status and a null value; a damaged one with status -1', () => {
    const d = connected();
    d.intent({ intent: 'read', tokens: ['posx'] });
    d.written();
    d.line('{"r":{},"f":[3,100,10]}');
    expect(d.state.values['posx']).toEqual({ value: null, status: 100, at: 0 });
    d.intent({ intent: 'read', tokens: ['mpox'] });
    d.written();
    d.line('{"r":{"mpox":');
    expect(d.state.values['mpox']).toEqual({ value: null, status: -1, at: 0 });
  });

  it('reads are refused while identifying', () => {
    const d = new Driver();
    d.open();
    expect(d.intent({ intent: 'read', tokens: ['stat'] })).toMatchObject({ allowed: false, citation: 'SAFETY H37; PN §12.3' });
  });

  it('every other intent is denied: by the matrix, or by the session in this release', () => {
    for (const intent of INTENTS) {
      if (['connect', 'disconnect', 'feedhold', 'stopJob', 'spindleOffNow', 'ackFault', 'acknowledgeLost', 'enq', 'read'].includes(intent)) continue;
      for (const d of [new Driver(), connected()]) {
        const decision = d.intent({ intent } as SessionIntent);
        expect(decision.allowed, intent).toBe(false);
        expect(d.last.filter((e) => e.kind !== 'decision'), intent).toEqual([]);
      }
    }
    // Offline intents the matrix allows are still not the session's to carry out.
    expect(new Driver().intent({ intent: 'cloudSync' })).toMatchObject({ allowed: false, citation: 'ROADMAP P1-02 (Phase 1)' });
  });

  it('disconnect closes the port and starts a new epoch; disconnecting while the port is being found works too', () => {
    const d = connected();
    const epoch = d.state.epoch;
    expect(d.intent({ intent: 'disconnect' })).toEqual({ allowed: true });
    expect(d.last).toContainEqual({ kind: 'close', epoch });
    expect(d.state).toMatchObject({ base: 'NOT_CONNECTED', epoch: epoch + 1, overlays: [] });
    expect(d.intent({ intent: 'disconnect' }).allowed).toBe(false);
    d.intent({ intent: 'connect', port: PORT, expectedDeviceId: null });
    expect(d.intent({ intent: 'disconnect' })).toEqual({ allowed: true });
    expect(d.state.base).toBe('NOT_CONNECTED');
  });

  it('disconnect cancels armed timers', () => {
    const d = new Driver();
    d.open();
    d.written();
    expect(d.state.timers.answer).toBeDefined();
    d.intent({ intent: 'disconnect' });
    expect(d.last).toContainEqual({ kind: 'cancelTimer', id: 'answer' });
    expect(d.state.timers).toEqual({});
  });

  it('with the Phase 0 release, connect is denied', () => {
    const d = new Driver({ release: CURRENT_RELEASE });
    expect(d.intent({ intent: 'connect', port: PORT, expectedDeviceId: null })).toMatchObject({ allowed: false, reason: 'Not available in this release.' });
  });

  it('the matrix snapshot and readability follow the state', () => {
    const d = new Driver();
    d.open();
    expect(matrixSnapshot(d.state)).toEqual({ base: 'IDENTIFYING', overlays: [], classified: false, enqCapable: false });
    expect(readableNow(d.state, 'fbs')).toBe(true);
    expect(readableNow(d.state, 'posx')).toBe(false);
    d.answer(EN_ANSWERS);
    expect(matrixSnapshot(d.state)).toEqual({ base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'], classified: true, enqCapable: true });
    expect(readableNow(d.state, 'fbs')).toBe(false);
    expect(readableNow(d.state, 'posx')).toBe(true);
    const u = connected({ ...EN_ANSWERS, fv: '{"r":{"fv":0.98},"f":[3,0,10]}' });
    expect(readableNow(u.state, 'sr')).toBe(false);
  });
});

describe('inbound lines that change nothing', () => {
  it('flow signals track XOFF; queue, rx and text reports are recorded or ignored', () => {
    const d = connected();
    d.inbound({ kind: 'FlowSignal', signal: 'xoff' });
    expect(d.state.xoff).toBe(true);
    d.inbound({ kind: 'FlowSignal', signal: 'xon' });
    expect(d.state.xoff).toBe(false);
    d.line('{"qr":28}');
    expect(d.state.live.qr).toBe(28);
    d.line('{"rx":200}');
    d.line('tinyg [mm] ok>');
    d.line('{"ack":true}');
    expect(d.state.fault).toBeNull();
  });

  it('a damaged line with nothing asked is ignored', () => {
    const d = connected();
    d.line('{"r":');
    expect(d.state.fault).toBeNull();
  });

  it('after classification, a 440.21 response whose checksum field is missing is damaged (dialect footer rule)', () => {
    const d = connected(TG_ANSWERS);
    d.intent({ intent: 'read', tokens: ['posx'] });
    d.written();
    d.line('{"r":{"posx":1},"f":[1,0,12]}');
    expect(d.state.values['posx']).toMatchObject({ status: -1 });
  });
});

/** A random inbound line, from shapes the board can send and shapes it should not. */
const inboundArb: fc.Arbitrary<Inbound> = fc.oneof(
  fc.constantFrom(
    ...Object.values(EN_ANSWERS),
    ...Object.values(TG_ANSWERS),
    EN_READY_BANNER,
    EN_BOOT_BANNER,
    TG_READY_BANNER,
    '{"sr":{"vel":10,"stat":5}}',
    '{"sr":{"stat":1,"vel":0}}',
    '{"er":{"fb":450.01,"st":20,"msg":"x"}}',
    '{"ack":true}',
    '{"qr":12}',
    '{"r":{},"f":[3,101,10]}',
    '{"r":{},"f":[2,0,10]}',
    '{"r":{"x":1},"f":[3,0,10],"tid":3}',
    'garbage{',
    'ok>',
  ).map((line) => classifyLine(line)),
  fc.constantFrom<Inbound>({ kind: 'FlowSignal', signal: 'xoff' }, { kind: 'FlowSignal', signal: 'xon' }),
);

const intentArb: fc.Arbitrary<SessionIntent> = fc.oneof(
  fc.constant<SessionIntent>({ intent: 'connect', port: PORT, expectedDeviceId: null }),
  fc.constant<SessionIntent>({ intent: 'connect', port: PORT, expectedDeviceId: 'OTHER-MACHINE' }),
  fc.constantFrom<Intent>(...INTENTS).filter((i) => i !== 'connect' && i !== 'read').map((intent) => ({ intent }) as SessionIntent),
  fc.array(fc.oneof(fc.constantFrom('posx', 'md', 'clear', 'stat', 'qr', '1ma', 'adc3', 'jogx'), fc.string({ maxLength: 6 })), { maxLength: 4 }).map((tokens) => ({ intent: 'read', tokens }) as SessionIntent),
);

type Step =
  | { readonly kind: 'intent'; readonly request: SessionIntent }
  | { readonly kind: 'inbound'; readonly event: Inbound }
  | { readonly kind: 'link'; readonly what: 'transportAcquired' | 'opened' | 'openFailed' | 'transportUnavailable' | 'lineWritten' | 'lineDropped' | 'writeFailed' | 'writeRefused' | 'linkLost' | 'driftDetected' }
  | { readonly kind: 'timer'; readonly id: 'answer' | 'settle' | 'verify' }
  /** The board answers the line in flight correctly (edge-next or 440.21 script). */
  | { readonly kind: 'reply'; readonly answers: Readonly<Record<string, string>> };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 3, arbitrary: intentArb.map((request) => ({ kind: 'intent' as const, request })) },
  { weight: 6, arbitrary: inboundArb.map((event) => ({ kind: 'inbound' as const, event })) },
  {
    weight: 6,
    arbitrary: fc
      .constantFrom('transportAcquired', 'opened', 'opened', 'lineWritten', 'lineWritten', 'lineWritten', 'lineDropped', 'openFailed', 'transportUnavailable', 'writeFailed', 'writeRefused', 'linkLost', 'driftDetected')
      .map((what) => ({ kind: 'link' as const, what: what as Extract<Step, { kind: 'link' }>['what'] })),
  },
  { weight: 12, arbitrary: fc.constantFrom(EN_ANSWERS, EN_ANSWERS, TG_ANSWERS).map((answers) => ({ kind: 'reply' as const, answers })) },
  { weight: 2, arbitrary: fc.constantFrom('answer', 'settle', 'verify').map((id) => ({ kind: 'timer' as const, id: id as 'answer' | 'settle' | 'verify' })) },
);

function apply(d: Driver, step: Step): void {
  switch (step.kind) {
    case 'reply': {
      const token = d.writing;
      if (token === undefined) return;
      d.written();
      const reply = step.answers[token] ?? EN_ANSWERS[token];
      if (reply !== undefined) d.line(reply);
      return;
    }
    case 'intent':
      d.intent(step.request);
      return;
    case 'inbound':
      d.inbound(step.event);
      return;
    case 'timer': {
      const seq = d.state.timers[step.id];
      if (seq !== undefined) d.fire(step.id);
      return;
    }
    case 'link': {
      const epoch = d.state.epoch;
      switch (step.what) {
        case 'openFailed':
        case 'transportUnavailable':
          d.feed({ type: step.what, epoch, reason: 'x' });
          return;
        case 'writeFailed':
        case 'writeRefused':
          d.feed({ type: step.what, epoch, at: 0, detail: 'x' });
          return;
        case 'linkLost':
          d.feed({ type: 'linkLost', epoch, at: 0 });
          return;
        case 'lineWritten':
        case 'lineDropped':
          d.feed({ type: step.what, epoch, seq: d.state.writing?.seq ?? 0 });
          return;
        case 'opened':
          d.feed({ type: 'opened', epoch, info: SIM_INFO });
          return;
        default:
          d.feed({ type: step.what, epoch });
      }
    }
  }
}

describe('T-S26, T-S24a: generated over states × events (and every overlay reached on the way)', () => {
  it('no effect ever carries 0x18 or 0x04; realtime is only ! and ENQ; every line is a single-token GET readable at that moment', () => {
    const seenBases = new Set<string>();
    const seenOverlays = new Set<string>();
    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 1, maxLength: 80 }),
        fc.boolean(),
        fc.integer({ min: -1, max: 20 }),
        fc.constantFrom(EN_ANSWERS, TG_ANSWERS),
        fc.constantFrom(null, 'EN-1', 'OTHER-MACHINE'),
        (steps, approved, prefix, answers, expected) => {
        const d = new Driver(approved ? { manifest: EN_APPROVED } : {});
        // Start part-way along the connection path, so deep states are reached as often as shallow ones.
        if (prefix >= 0) {
          d.open(expected);
          let n = 0;
          d.answer(answers, () => n++ >= prefix);
          seenBases.add(d.state.base);
        }
        for (const step of steps) {
          const before = d.state;
          apply(d, step);
          seenBases.add(d.state.base);
          for (const o of d.state.overlays) seenOverlays.add(o);
          for (const effect of d.last) {
            if (effect.kind === 'writeRealtime') {
              expect([BYTE.FEEDHOLD, BYTE.ENQ]).toContain(effect.byte);
              expect(effect.byte).not.toBe(BYTE.RESET);
              expect(effect.byte).not.toBe(BYTE.KILL);
              if (effect.byte === BYTE.ENQ) {
                expect(effect.name).toBe('enq');
                expect(enqAllowedNow(before) || enqAllowedNow(d.state)).toBe(true);
              }
            }
            if (effect.kind === 'writeLine') {
              const m = /^\{"?([a-z0-9_]+)"?:null\}$/.exec(effect.line);
              expect(m?.[1], effect.line).toBe(effect.token);
              expect(readableNow(d.state, effect.token), effect.line).toBe(true);
            }
          }
          expect(d.state.overlays).toEqual(OVERLAYS.filter((o) => d.state.overlays.includes(o)));
          // At most one line in flight.
          expect((d.state.writing === null ? 0 : 1) + d.state.expected.filter((e) => !e.late).length).toBeLessThanOrEqual(1);
        }
      },
      ),
      { numRuns: 3000, seed: 0x5e55 },
    );
    expect([...seenBases].sort()).toEqual(['BLOCKED', 'CONNECTED_UNKNOWN', 'IDENTIFYING', 'NOT_CONNECTED', 'OPENING', 'PORT_REQUEST', 'READING'].sort());
    expect([...seenOverlays].sort()).toEqual([...OVERLAYS].sort());
   }, 30_000);

  it('the dialect data agrees: the realtime bytes the session uses are the dialect feedhold and ENQ', () => {
    expect(TINYG_EN.realtime.feedhold.byte).toBe(BYTE.FEEDHOLD);
    expect(TINYG_EN.realtime.enq?.byte).toBe(BYTE.ENQ);
  });
});

describe('ordering of answers and writes', () => {
  it('an answer that arrives before the transport reports its write complete is still that line\'s answer', () => {
    const d = new Driver();
    d.open();
    const first = d.state.writing?.seq as number;
    // The board answers {sr:null} before lineWritten: the probe moves on to fb.
    d.line(EN_ANSWERS.sr as string);
    expect(d.writing).toBe('fb');
    expect(d.state.timers.answer).toBeUndefined();
    // The late completion of the first line is not taken for fb's.
    d.feed({ type: 'lineWritten', epoch: d.state.epoch, seq: first });
    expect(d.writing).toBe('fb');
    expect(d.state.expected).toEqual([]);
    d.written();
    expect(d.state.expected).toEqual([{ token: 'fb', purpose: 'probe', late: false }]);
  });

  it('a damaged answer before the write completes is the damaged answer of the line being written', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'fb');
    d.line('{"r":{"fb":');
    expect(d.state.classification).toMatchObject({ reason: 'probeFailed', detail: 'the answer to the fb probe arrived damaged' });
    expect(d.state.writing).toBeNull();
  });

  it('a lineDropped for another line changes nothing; for the line being written it frees the slot', () => {
    const d = connected();
    d.intent({ intent: 'read', tokens: ['posx'] });
    const seq = d.state.writing?.seq as number;
    d.feed({ type: 'lineDropped', epoch: d.state.epoch, seq: seq + 1 });
    expect(d.writing).toBe('posx');
    d.feed({ type: 'lineDropped', epoch: d.state.epoch, seq });
    expect(d.state.writing).toBeNull();
  });

  it('two reads timing out in turn: the older late entry stays late and is dropped when a newer answer arrives', () => {
    const d = connected();
    d.intent({ intent: 'read', tokens: ['posx'] });
    d.written();
    d.fire('answer');
    d.intent({ intent: 'read', tokens: ['mpox'] });
    d.written();
    d.fire('answer');
    expect(d.state.expected).toEqual([
      { token: 'posx', purpose: 'request', late: true },
      { token: 'mpox', purpose: 'request', late: true },
    ]);
    d.line(EN_ANSWERS.mpox as string);
    expect(d.state.expected).toEqual([]);
    expect(d.state.fault).toBeNull();
  });
});

describe('guards that only a broken invariant reaches (fabricated states)', () => {
  it('a settle timer without a probe does nothing', () => {
    const d = new Driver();
    d.open();
    d.line(EN_READY_BANNER);
    d.state = { ...d.state, probe: null };
    d.fire('settle');
    expect(d.state.base).toBe('IDENTIFYING');
    expect(d.state.queue).toEqual([]);
  });

  it('a queued read the matrix does not allow now is not written', () => {
    const d = connected();
    d.state = { ...d.state, overlays: ['ORPHANED_MOTION'], dialect: null, classification: null, queue: [{ token: 'sr', purpose: 'splice' }] };
    d.feed({ type: 'driftDetected', epoch: d.state.epoch });
    expect(d.state.writing).toBeNull();
    expect(d.lines()).toEqual(EN_CONNECT);
  });

  it('a queued token that is not readable in this state is never written: FAULT (writeRefused)', () => {
    const d = connected();
    d.state = { ...d.state, queue: [{ token: 'md', purpose: 'request' }] };
    d.feed({ type: 'driftDetected', epoch: d.state.epoch });
    expect(d.state.fault).toMatchObject({ cause: 'writeRefused', detail: 'no allowlisted GET for "md" in this state' });
    expect(d.lines()).not.toContain('{"md":null}');
    const probe = new Driver();
    probe.open();
    probe.state = { ...probe.state, writing: null, queue: [{ token: 'posx', purpose: 'probe' }] };
    probe.feed({ type: 'driftDetected', epoch: probe.state.epoch });
    expect(probe.state.fault?.cause).toBe('writeRefused');
  });

  it('a board that answers no id when a machine is selected is BLOCKED with no reported id', () => {
    const d = connected({ ...EN_ANSWERS, id: '{"r":{},"f":[3,100,10]}' }, {}, 'MACHINE-7');
    expect(d.state.base).toBe('BLOCKED');
    expect(d.state.blocked).toEqual({ expected: 'MACHINE-7', reported: null });
  });

  it('identity carries fbs when the board reports one', () => {
    const d = connected({ ...EN_ANSWERS, fbs: '{"r":{"fbs":"ead63997"},"f":[3,0,10]}' });
    expect(d.state.identity).toMatchObject({ fbs: 'ead63997' });
  });
});

describe('bench 3, 2026-11-04: an unidentified board in ORPHANED_MOTION, then a hardware reset', () => {
  it('Disconnect is allowed throughout, and the reset banner ends ORPHANED_MOTION (FAULT and UNKNOWN as for any reset)', () => {
    const d = new Driver();
    d.open();
    d.written();
    // footer-only replies (jv 2): stat 3 with nothing readable, every probe GET answered empty
    d.line('{"r":{"sr":{"posx":0.000,"stat":3}},"f":[3,0,10]}');
    for (let i = 0; i < 20 && d.writing !== undefined; i++) {
      d.written();
      d.line('{"r":{},"f":[3,0,10]}');
    }
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
    expect(d.intent({ intent: 'disconnect' })).toEqual({ allowed: true });
    d.open();
    d.written();
    d.line('{"r":{"sr":{"posx":0.000,"stat":3}},"f":[3,0,10]}');
    for (let i = 0; i < 20 && d.writing !== undefined; i++) {
      d.written();
      d.line('{"r":{},"f":[3,0,10]}');
    }
    d.line(EN_BOOT_BANNER);
    expect(d.state.overlays).not.toContain('ORPHANED_MOTION');
    expect(d.state.overlays).toEqual(expect.arrayContaining(['FAULT', 'UNKNOWN']));
    expect(d.intent({ intent: 'disconnect' })).toEqual({ allowed: true });
  });
});
