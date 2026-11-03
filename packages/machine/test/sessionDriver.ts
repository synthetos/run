/**
 * A driver for the pure session reducer: feeds it events, keeps every
 * effect, and answers its GETs from a script. No transport, no clock.
 */
import { NO_APPROVED_BUILDS, checksum440, classifyLine, type ApprovedBuilds, type Inbound } from '@synthetos/protocol';
import { PHASE_1_RELEASE, type Decision, type Release } from '@synthetos/safety';
import { DEFAULT_TIMINGS, initialState, reduce, type SessionConfig, type SessionEffect, type SessionEvent, type SessionIntent, type SessionState, type TimerId } from '../src/index.ts';
import { PORT } from './simTransport.ts';

/** The connect-time state read on edge-next (SEED_TOKENS), as the EN model prints them. */
export const SEED_EN: Readonly<Record<string, string>> = Object.freeze({
  home: '{"r":{"home":0},"f":[3,0,10]}',
  hom: '{"r":{"hom":{"x":0,"y":0,"z":0,"a":0,"e":0}},"f":[3,0,10]}',
  unit: '{"r":{"unit":1},"f":[3,0,10]}',
  coor: '{"r":{"coor":1},"f":[3,0,10]}',
  dist: '{"r":{"dist":0},"f":[3,0,10]}',
  tool: '{"r":{"tool":0},"f":[3,0,10]}',
  mpo: '{"r":{"mpo":{"x":2.5,"y":0,"z":0,"a":0,"b":0,"c":0}},"f":[3,0,10]}',
  pos: '{"r":{"pos":{"x":1.5,"y":0,"z":0,"a":0,"b":0,"c":0}},"f":[3,0,10]}',
  ofs: '{"r":{"ofs":{"x":1,"y":0,"z":0,"a":0,"b":0,"c":0}},"f":[3,0,10]}',
  g92: '{"r":{"g92":{"x":0,"y":0,"z":0,"a":0,"b":0,"c":0}},"f":[3,0,10]}',
  g28: '{"r":{"g28":{"x":0,"y":0,"z":0,"a":0,"b":0,"c":0}},"f":[3,0,10]}',
  g30: '{"r":{"g30":{"x":0,"y":0,"z":0,"a":0,"b":0,"c":0}},"f":[3,0,10]}',
  spe: '{"r":{"spe":0},"f":[3,0,10]}',
  spc: '{"r":{"spc":0},"f":[3,0,10]}',
  spd: '{"r":{"spd":0},"f":[3,0,10]}',
  sps: '{"r":{"sps":0},"f":[3,0,10]}',
  cof: '{"r":{"cof":0},"f":[3,0,10]}',
  com: '{"r":{"com":0},"f":[3,0,10]}',
  sv: '{"r":{"sv":1},"f":[3,0,10]}',
  si: '{"r":{"si":250},"f":[3,0,10]}',
  // No heartbeat on this scripted board: {"rt":null} answers 100.
  rt: '{"r":{},"f":[3,100,10]}',
});

/** Edge-next answers (footer rev 3), as the EN model prints them. */
export const EN_ANSWERS: Readonly<Record<string, string>> = Object.freeze({
  sr: '{"r":{"sr":{"line":0,"posx":1.5,"posy":0,"posz":0,"vel":0,"unit":1,"stat":1}},"f":[3,0,10]}',
  fb: '{"r":{"fb":450.01},"f":[3,0,10]}',
  fv: '{"r":{"fv":0.97},"f":[3,0,10]}',
  hp: '{"r":{"hp":1},"f":[3,0,10]}',
  id: '{"r":{"id":"EN-1"},"f":[3,0,10]}',
  hv: '{"r":{"hv":8},"f":[3,0,10]}',
  fbs: '{"r":{},"f":[3,100,10]}',
  spep: '{"r":{"spep":1},"f":[3,0,10]}',
  prbp: '{"r":{"prbp":0},"f":[3,0,10]}',
  fstk: '{"r":{"fstk":1200},"f":[3,0,10]}',
  os: '{"r":{"os":0},"f":[3,0,10]}',
  spph: '{"r":{},"f":[3,17,10]}',
  stat: '{"r":{"stat":1},"f":[3,0,10]}',
  hold: '{"r":{"hold":0},"f":[3,0,10]}',
  vel: '{"r":{"vel":0.00},"f":[3,0,10]}',
  qr: '{"r":{"qr":32},"f":[3,0,10]}',
  ex: '{"r":{"ex":1},"f":[3,0,10]}',
  posx: '{"r":{"posx":1.5},"f":[3,0,10]}',
  mpox: '{"r":{"mpox":2.5},"f":[3,0,10]}',
  // The connect-time state read (amendment 2026-11-02).
  ...SEED_EN,
});

/** A 440.21 response line with its checksum (rev 1, four fields). */
export function tg(body: string, status = 0, len = 12): string {
  const head = `{"r":${body},"f":[1,${status},${len},`;
  return `${head}${checksum440(head)}]}`;
}

export const TG_ANSWERS: Readonly<Record<string, string>> = Object.freeze({
  sr: tg('{"sr":{"posx":0,"vel":0,"stat":1}}'),
  fb: tg('{"fb":440.21}'),
  fv: tg('{"fv":0.97}'),
  hp: tg('{"hp":1}'),
  id: tg('{"id":"TG-1"}'),
  hv: tg('{"hv":8}'),
  fbs: tg('{}', 100),
  spep: tg('{}', 100),
  prbp: tg('{}', 100),
  fstk: tg('{}', 100),
  os: tg('{}', 100),
  spph: tg('{}', 100),
  stat: tg('{"stat":1}'),
  hold: tg('{"hold":0}'),
  vel: tg('{"vel":0}'),
  qr: tg('{"qr":32}'),
  ex: tg('{"ex":1}'),
  home: tg('{"home":0}'),
  hom: tg('{"hom":{"x":0,"y":0,"z":0,"a":0}}'),
  unit: tg('{"unit":1}'),
  coor: tg('{"coor":1}'),
  dist: tg('{"dist":0}'),
  tool: tg('{"tool":0}'),
  mpo: tg('{"mpo":{"x":0,"y":0,"z":0}}'),
  pos: tg('{"pos":{"x":0,"y":0,"z":0}}'),
  ofs: tg('{"ofs":{"x":0,"y":0,"z":0}}'),
  g92: tg('{"g92":{"x":0,"y":0,"z":0}}'),
  g28: tg('{"g28":{"x":0,"y":0,"z":0}}'),
  g30: tg('{"g30":{"x":0,"y":0,"z":0}}'),
  sv: tg('{"sv":1}'),
  si: tg('{"si":250}'),
});

export const EN_READY_BANNER = '{"sr":{"fv":0.970,"fb":450.01,"hp":1,"hv":8,"id":"EN-1","msg":"SYSTEM READY"}}';
export const EN_BOOT_BANNER = '{"sr":{"fv":0.970,"fb":450.01,"hp":1,"hv":8,"id":"EN-1","msg":"Initializing configs to default settings"}}';
export const TG_READY_BANNER = (() => {
  const head = '{"r":{"fv":0.970,"fb":440.21,"hp":1,"hv":8,"id":"TG-1","msg":"SYSTEM READY"},"f":[1,0,0,';
  return `${head}${checksum440(head)}]}`;
})();

export const SIM_INFO = Object.freeze({ kind: 'sim' as const, usbVendorId: 0x0403, usbProductId: 0x6015 });

export interface DriverOptions {
  readonly release?: Release;
  readonly manifest?: ApprovedBuilds;
}

export class Driver {
  readonly config: SessionConfig;
  state: SessionState = initialState();
  /** Every effect, in order. */
  readonly effects: SessionEffect[] = [];
  /** Effects of the last event only. */
  last: readonly SessionEffect[] = [];
  at = 0;

  constructor(options: DriverOptions = {}) {
    this.config = { release: options.release ?? PHASE_1_RELEASE, manifest: options.manifest ?? NO_APPROVED_BUILDS, timings: DEFAULT_TIMINGS };
  }

  feed(event: SessionEvent): readonly SessionEffect[] {
    const { state, effects } = reduce(this.config, this.state, event);
    this.state = state;
    this.last = effects;
    this.effects.push(...effects);
    return effects;
  }

  intent(request: SessionIntent): Decision {
    const effects = this.feed({ type: 'intent', at: this.at, request });
    const decisions = effects.filter((e) => e.kind === 'decision');
    if (decisions.length !== 1) throw new Error(`expected one decision, got ${decisions.length}`);
    return (decisions[0] as Extract<SessionEffect, { kind: 'decision' }>).decision;
  }

  /** Connect and open: the session is IDENTIFYING with `{sr:null}` handed to the transport. */
  open(expectedDeviceId: string | null = null): void {
    this.intent({ intent: 'connect', port: PORT, expectedDeviceId });
    this.feed({ type: 'transportAcquired', epoch: this.state.epoch });
    this.feed({ type: 'opened', epoch: this.state.epoch, info: SIM_INFO });
  }

  inbound(event: Inbound): readonly SessionEffect[] {
    return this.feed({ type: 'inbound', epoch: this.state.epoch, at: this.at, event });
  }

  line(text: string): readonly SessionEffect[] {
    return this.inbound(classifyLine(text));
  }

  /** The line handed to the transport completed. */
  written(): readonly SessionEffect[] {
    return this.feed({ type: 'lineWritten', epoch: this.state.epoch, seq: this.state.writing?.seq ?? -1 });
  }

  /** The token of the line being written, or undefined. */
  get writing(): string | undefined {
    return this.state.writing?.token;
  }

  /** Fires the armed timer `id`. */
  fire(id: TimerId): readonly SessionEffect[] {
    const seq = this.state.timers[id];
    if (seq === undefined) throw new Error(`timer ${id} is not armed`);
    return this.feed({ type: 'timer', id, seq, at: this.at });
  }

  /** Answers GETs from `answers` until nothing is written or `stop` says so. Returns the tokens answered. */
  answer(answers: Readonly<Record<string, string>>, stop: (token: string) => boolean = () => false): string[] {
    const done: string[] = [];
    for (let guard = 0; guard < 100; guard++) {
      const token = this.writing;
      if (token === undefined || stop(token)) break;
      this.written();
      const reply = answers[token];
      if (reply === undefined) throw new Error(`no scripted answer for ${token}`);
      this.line(reply);
      done.push(token);
    }
    return done;
  }

  /** Every line the reducer asked to write, in order. */
  lines(): string[] {
    return this.effects.filter((e) => e.kind === 'writeLine').map((e) => (e as Extract<SessionEffect, { kind: 'writeLine' }>).line);
  }

  /** Every realtime byte the reducer asked to write, in order. */
  realtime(): number[] {
    return this.effects.filter((e) => e.kind === 'writeRealtime').map((e) => (e as Extract<SessionEffect, { kind: 'writeRealtime' }>).byte);
  }
}
