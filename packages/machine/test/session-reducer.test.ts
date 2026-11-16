import { BYTE, TINYG_EN, classifyLine, type Inbound } from '@synthetos/protocol';
import { INTENTS, OVERLAYS, type Intent } from '@synthetos/safety';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { enqAllowedNow, readableNow, type SessionIntent } from '../src/index.ts';
import { Driver, EN_ANSWERS, EN_BOOT_BANNER, EN_READY_BANNER, SIM_INFO, TG_ANSWERS, TG_READY_BANNER } from './sessionDriver.ts';
import { EN_APPROVED } from './sessionReducerFixtures.ts';
import { PORT } from './simTransport.ts';



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
  | { readonly kind: 'intent'; readonly request: SessionIntent; }
  | { readonly kind: 'inbound'; readonly event: Inbound; }
  | { readonly kind: 'link'; readonly what: 'transportAcquired' | 'opened' | 'openFailed' | 'transportUnavailable' | 'lineWritten' | 'lineDropped' | 'writeFailed' | 'writeRefused' | 'linkLost' | 'driftDetected'; }
  | { readonly kind: 'timer'; readonly id: 'answer' | 'settle' | 'verify'; }
  /** The board answers the line in flight correctly (edge-next or 440.21 script). */
  | { readonly kind: 'reply'; readonly answers: Readonly<Record<string, string>>; };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 3, arbitrary: intentArb.map((request) => ({ kind: 'intent' as const, request })) },
  { weight: 6, arbitrary: inboundArb.map((event) => ({ kind: 'inbound' as const, event })) },
  {
    weight: 6,
    arbitrary: fc
      .constantFrom('transportAcquired', 'opened', 'opened', 'lineWritten', 'lineWritten', 'lineWritten', 'lineDropped', 'openFailed', 'transportUnavailable', 'writeFailed', 'writeRefused', 'linkLost', 'driftDetected')
      .map((what) => ({ kind: 'link' as const, what: what as Extract<Step, { kind: 'link'; }>['what'] })),
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
      applyLink(d, step);

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
        generatedSequence(seenBases, seenOverlays),
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

describe('bench 3, 2026-11-04: an unidentified board in ORPHANED_MOTION, then a hardware reset', () => {

  it('Disconnect is allowed throughout, and the reset banner ends ORPHANED_MOTION (FAULT and UNKNOWN as for any reset)', () => {
    const d = new Driver();
    d.open();
    d.written();
    // footer-only replies (jv 2): stat 3 with nothing readable, every probe GET answered empty
    d.line('{"r":{"sr":{"posx":0.000,"stat":3}},"f":[3,0,10]}');
    for (let i = 0;i < 20 && d.writing !== undefined;i++) {
      d.written();
      d.line('{"r":{},"f":[3,0,10]}');
    }
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
    expect(d.intent({ intent: 'disconnect' })).toEqual({ allowed: true });
    d.open();
    d.written();
    d.line('{"r":{"sr":{"posx":0.000,"stat":3}},"f":[3,0,10]}');
    for (let i = 0;i < 20 && d.writing !== undefined;i++) {
      d.written();
      d.line('{"r":{},"f":[3,0,10]}');
    }
    d.line(EN_BOOT_BANNER);
    expect(d.state.overlays).not.toContain('ORPHANED_MOTION');
    expect(d.state.overlays).toEqual(expect.arrayContaining(['FAULT', 'UNKNOWN']));
    expect(d.intent({ intent: 'disconnect' })).toEqual({ allowed: true });
  });
});

function generatedSequence(seenBases: Set<string>, seenOverlays: Set<string>) {
  return (...[steps, approved, prefix, answers, expected]: [Step[], boolean, number, Readonly<Record<string, string>>, string | null]) => {
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
  };
}

function applyLink(d: Driver, step: Extract<Step, { kind: 'link'; }>): void {
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
