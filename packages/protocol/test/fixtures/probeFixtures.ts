/**
 * Probe transcripts for the classifier tests (T-S55), as the raw lines a
 * board prints, run through the real line classifier.
 *
 * No bench capture of the full probe exists yet (B-PROBE-1). The lines are
 * constructed from source at the pinned commits:
 * - edge-next: values from EN config_app.c:139-143, :650-668 (tokens),
 *   :65-69 (`spph` → 17), footer rev 3 from EN json_parser.c:960 (rxm=1 default);
 * - 440.21: footer rev 1 with a real checksum (TG json_parser.c:529, :550);
 *   the capability tokens do not exist there, so they answer 100;
 * - stock 449: footer rev 3 (S449 json_parser.c:686); tokens answer 100;
 * - g2core: footer `[1,status,n]` (G2 json_parser.cpp:612-616), string hp/hv.
 * Replace with B-PROBE-1 captures when the bench closes it.
 */
import { checksum440, classifyLine } from '../../src/classify.ts';
import type { ProbeKey, ProbeObservations } from '../../src/probe.ts';
import type { Banner, Response } from '../../src/types.ts';

/** Footer revision; `g2` is revision 1 without the TinyG checksum field. */
type Rev = 1 | 2 | 3 | 'g2';
export type ProbeAnswers = Partial<Record<Exclude<ProbeKey, 'sr'>, { body: string; status: number }>>;

/** One response line for `body` (the inside of `r`) at a footer revision. */
export function responseLine(body: string, status: number, rev: Rev): string {
  if (rev === 'g2') return `{"r":{${body}},"f":[1,${status},12]}`;
  if (rev !== 1) return `{"r":{${body}},"f":[${rev},${status},11]}`;
  const prefix = `{"r":{${body}},"f":[1,${status},12,`;
  return `${prefix}${checksum440(`${prefix}0`)}]}`;
}

export function toResponse(line: string): Response {
  const c = classifyLine(line);
  if (c.kind !== 'Response') throw new Error(`fixture is not a Response: ${line} (${c.kind})`);
  return c;
}

export function toBanner(line: string): Banner {
  const c = classifyLine(line);
  if (c.kind !== 'Banner') throw new Error(`fixture is not a Banner: ${line} (${c.kind})`);
  return c;
}

export function observations(answers: ProbeAnswers, rev: Rev, banner?: string): ProbeObservations {
  const map = new Map<ProbeKey, Response>();
  for (const [key, a] of Object.entries(answers)) map.set(key as ProbeKey, toResponse(responseLine(a.body, a.status, rev)));
  return banner === undefined ? { answers: map } : { answers: map, banner: toBanner(banner) };
}

const value = (key: string, v: string) => ({ body: `"${key}":${v}`, status: 0 });
const unrecognized = (key: string) => ({ body: `"${key}":null`, status: 100 });

/** Identity answers of a TinyG v8 at build `fb`. */
export function tinygIdentity(fb: string): ProbeAnswers {
  return {
    fb: value('fb', fb),
    fv: value('fv', '0.970'),
    hp: value('hp', '1'),
    id: value('id', '"0BENCH-TWO"'),
    hv: value('hv', '8'),
    // No TinyG build reports fbs yet (D4): the GET answers 100.
    fbs: unrecognized('fbs'),
  };
}

/** Edge-next: the four capability tokens answer, `spph` is stubbed (17). */
export const EN_CAPABILITIES: ProbeAnswers = {
  spep: value('spep', '1'),
  prbp: value('prbp', '0'),
  fstk: value('fstk', '1180'),
  os: value('os', '0'),
  spph: { body: '', status: 17 },
};

/** A build without the edge-next tokens: everything answers 100. */
export const NO_CAPABILITIES: ProbeAnswers = {
  spep: unrecognized('spep'),
  prbp: unrecognized('prbp'),
  fstk: unrecognized('fstk'),
  os: unrecognized('os'),
  spph: unrecognized('spph'),
};

/** Edge-next at 6ec70652 (fb 450.01), rxm=1. */
export const EN_450 = (): ProbeObservations => observations({ ...tinygIdentity('450.01'), ...EN_CAPABILITIES }, 3);
/** Stock 440.21. */
export const TG_440 = (): ProbeObservations => observations({ ...tinygIdentity('440.21'), ...NO_CAPABILITIES }, 1);
/** Stock edge-0.97 449.01. */
export const STOCK_449 = (): ProbeObservations => observations({ ...tinygIdentity('449.01'), ...NO_CAPABILITIES }, 3);

/** g2core edge on an Arduino Due (G2 board/ArduinoDue/hardware.h:43-44). */
export const G2_EDGE = (fb = '101.06'): ProbeObservations =>
  observations(
    {
      fb: value('fb', fb),
      fv: value('fv', '0.99'),
      hp: value('hp', '"ArduinoDue"'),
      id: value('id', '"3X0000-AAC"'),
      hv: value('hv', '"na"'),
      fbs: value('fbs', '"101.06-2-gabc1234"'),
      ...NO_CAPABILITIES,
      // g2 has its own spep and spph (G2 spindle.cpp:479, :483); prbp, fstk and os do not exist there.
      spep: value('spep', '1'),
      spph: value('spph', 'false'),
    },
    'g2',
  );
