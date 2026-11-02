/**
 * The read-only capability probe (ROADMAP P0-08; PN §2.3; SAFETY H44, H49).
 *
 * `PROBE_STEPS` is the probe as data: one allowlisted GET per line, one key
 * per line, in order. It never sends G-code (an unsupported word raises ALARM
 * on stock 449, E042), never reads `adc3` (it starts an ADC conversion on the
 * SPI2/J13 pin, @cite EN config_app.c:660), and never reads a token with side
 * effects (E138, PN §12.3). The first line written at connect is `{sr:null}`
 * (`SPLICE_GUARD_LINE`): it completes and spoils any partial line a previous
 * sender left in the RX ring, so that line never runs (PN §2.3 step 0, H49).
 *
 * The key is bare on purpose. On 440.21 in JSON mode (its default, and the
 * mode any JSON sender leaves behind) a G-code line is run wrapped as
 * `{"gc":"<line>"}`, and the gc string ends at the line's first double quote
 * with no syntax error (@cite TG controller.c:277-282, json_parser.c:273-277,
 * :309-321). A quoted `{"sr":null}` after a fragment `G0 X1` would leave
 * gc = `G0 X1{`, and G0 X1 would run. With no quote in the line, the whole
 * `G0 X1{sr:null}` reaches the G-code parser (wrapped or not) and fails as
 * `G0X1SRNULL`. The same holds for a partial JSON line (`{"gc":"G0 X1`),
 * whose string is then never closed. TinyG's tokenizer accepts bare keys
 * (@cite EN json_parser.c:262-275), so on a clean ring it is an ordinary GET.
 *
 * Timing, the one-line-in-flight rule, the single `{"sr":null}` retry and the
 * ORPHANED_MOTION path on silence belong to the machine (P1). This module only
 * says what to send and turns the answers into a `ProbeResult`.
 *
 * `hv` is read in addition to PN §2.3 step 2: board selection needs it
 * (RUN_PLAN §5.1 rule 6, `hp`/`hv` pick the board definition), and the banner
 * that also carries it is absent when connecting to a board already powered.
 *
 * `fbs` (the build hash, D4) is read for the same reason: a board that is
 * already powered sends no banner, so the banner alone cannot say whether
 * the build reports one. Without the GET, a build that does report `fbs`
 * would look like one that does not and match a manifest entry approved
 * with `fbs: null` (P0 review). Firmware that has no `fbs` answers 100
 * (unrecognised): that is the only answer that means "reports none".
 */
import type { Banner, Footer, JsonValue, Response } from './types.ts';

/** Status codes the probe interprets. Probing happens before classification, so these hold on every family. */
export const PROBE_STATUS = Object.freeze({
  OK: 0,
  /** STAT_FUNCTION_IS_STUBBED (@cite EN error.h:92; TG tinyg.h:280; G2 error.h:84). */
  STUBBED: 17,
  /** STAT_UNRECOGNIZED_NAME (@cite EN error.h:192; TG tinyg.h:378; G2 error.h:186). */
  UNRECOGNIZED: 100,
});

/** Identity tokens (PN §2.3 step 2, plus `hv`). */
export const IDENTITY_TOKENS = Object.freeze(['fb', 'fv', 'hp', 'id', 'hv'] as const);
/** Edge-next capability tokens (PN §2.3 step 3; @cite EN config_app.c:649-667). */
export const CAPABILITY_TOKENS = Object.freeze(['spep', 'prbp', 'fstk', 'os'] as const);
/** EN answers 17 (stubbed) while E060 is not merged (PN §2.3 step 4; @cite EN config_app.c:64-68, :652). */
export const SPINDLE_PAUSE_TOKEN = 'spph';
/**
 * The coolant pause-on-hold setting (g2 `coph`; reserved and stubbed on
 * edge-next). Read it, as its own fact, wherever `caps.coolantPauseOnHold`
 * is `probe`; it is not part of the identity probe sequence.
 */
export const COOLANT_PAUSE_TOKEN = 'coph';
/** The build hash (D4; g2core reports it today, @cite OLD-PN §2.2). TinyG builds without it answer 100. */
export const BUILD_HASH_TOKEN = 'fbs';

export type IdentityToken = (typeof IDENTITY_TOKENS)[number];
export type CapabilityToken = (typeof CAPABILITY_TOKENS)[number];
export type ProbeKey = 'sr' | IdentityToken | typeof BUILD_HASH_TOKEN | CapabilityToken | typeof SPINDLE_PAUSE_TOKEN;

export interface ProbeStep {
  readonly key: ProbeKey;
  /** The line to write, without its terminator (the transport adds LF). */
  readonly line: string;
  readonly stage: 'spliceGuard' | 'identity' | 'buildHash' | 'capability' | 'spindlePause';
}

/** The splice guard, the first line of every probe: a GET of `sr` with a bare key (see the module comment). */
export const SPLICE_GUARD_LINE = '{sr:null}';

function get(key: ProbeKey, stage: ProbeStep['stage']): ProbeStep {
  return Object.freeze({ key, line: `{"${key}":null}`, stage });
}

/** The probe, in order. Every line is a single-key GET. */
export const PROBE_STEPS: readonly ProbeStep[] = Object.freeze([
  Object.freeze({ key: 'sr', line: SPLICE_GUARD_LINE, stage: 'spliceGuard' }),
  ...IDENTITY_TOKENS.map((k) => get(k, 'identity')),
  get(BUILD_HASH_TOKEN, 'buildHash'),
  ...CAPABILITY_TOKENS.map((k) => get(k, 'capability')),
  get(SPINDLE_PAUSE_TOKEN, 'spindlePause'),
]);

/** How a capability token answered. `other` is any other status, or a malformed answer. */
export type TokenAnswer = 'value' | 'unrecognized' | 'other';
export type SpphAnswer = 'stubbed' | 'value' | 'unrecognized' | 'other';

/**
 * What the probe learned (RUN_PLAN §5.5 `ProbeResult`). Two additions:
 * `hv` (board selection) and `conflicts`, every inconsistency seen while
 * reading the answers. Any conflict makes the classifier return READ_ONLY.
 */
export interface ProbeResult {
  readonly banner: 'r-footer' | 'bare-sr' | 'none';
  readonly footerRev: 1 | 2 | 3;
  readonly fb?: number;
  readonly fv?: number;
  readonly hp?: number | string;
  readonly hv?: number | string;
  readonly id?: string;
  readonly tokens: Readonly<Record<CapabilityToken, TokenAnswer>>;
  readonly spph: SpphAnswer;
  /**
   * Build hash from the `fbs` GET (g2core today; proposed for edge-next,
   * D4). Absent only when the GET answered 100 (the build reports none).
   * A banner `fbs` that disagrees with the GET is a conflict.
   */
  readonly fbs?: string;
  /** Capability bitmask: proposed for edge-next (D4); no build reports it yet. */
  readonly cap?: number;
  /**
   * Every footer the probe saw, as received: the banner's (an `r-footer`
   * banner) first, then each answer in `PROBE_STEPS` order. The probe runs
   * before the dialect is known, so it cannot judge footer shape itself; the
   * classifier checks every one against the candidate dialect's footer
   * contract (440.21 always prints a checksum, g2core never does) before it
   * allows full mode (P0-08 review). Empty only in a hand-built result,
   * which the classifier never trusts.
   */
  readonly footers: readonly Footer[];
  readonly conflicts: readonly string[];
}

export interface ProbeObservations {
  /** The boot banner seen during the probe, if any (none is normal on a board already powered). */
  readonly banner?: Banner;
  /** The board's answer to each GET of `PROBE_STEPS` after `sr`, keyed by token. */
  readonly answers: ReadonlyMap<ProbeKey, Response>;
}

export type ProbeOutcome =
  | { readonly ok: true; readonly result: ProbeResult }
  /** The probe cannot be classified at all: the board stays unclassified (SAFETY §3). */
  | { readonly ok: false; readonly reason: 'missing-answer' | 'footer-revision-changed'; readonly key: ProbeKey };

type IdentityValues = { fb?: number; fv?: number; hp?: number | string; hv?: number | string; id?: string };

/** Turn the probe answers into a `ProbeResult`. Pure; never throws. */
export function buildProbeResult(obs: ProbeObservations): ProbeOutcome {
  const steps = PROBE_STEPS.filter((s) => s.stage !== 'spliceGuard');
  let footerRev: 1 | 2 | 3 | undefined;
  for (const step of steps) {
    const answer = obs.answers.get(step.key);
    if (answer === undefined) return { ok: false, reason: 'missing-answer', key: step.key };
    // The footer revision is fixed per board configuration; a change means a reset or a reconfiguration.
    if (footerRev !== undefined && answer.footer.rev !== footerRev) {
      return { ok: false, reason: 'footer-revision-changed', key: step.key };
    }
    footerRev = answer.footer.rev;
  }

  const conflicts: string[] = [];
  const answer = (key: ProbeKey): Response => obs.answers.get(key) as Response;
  for (const step of steps) {
    // The probe sends no tid, so an echoed one answers some other request (SAFETY §3).
    if (answer(step.key).tid !== undefined) conflicts.push(`${step.key}: unexpected tid`);
  }

  const identity: IdentityValues = {};
  for (const key of IDENTITY_TOKENS) {
    const r = answer(key);
    const value = singleValue(r, key);
    if (r.footer.status !== PROBE_STATUS.OK || value === undefined) {
      conflicts.push(`${key}: no value (status ${r.footer.status})`);
      continue;
    }
    if (!assignIdentity(identity, key, value)) conflicts.push(`${key}: unexpected type`);
  }

  if (obs.banner !== undefined) {
    for (const key of ['fb', 'fv', 'hp', 'hv', 'id'] as const) {
      const fromBanner = obs.banner[key];
      const fromGet = identity[key];
      if (fromBanner !== undefined && fromGet !== undefined && fromBanner !== fromGet) {
        conflicts.push(`${key}: banner says ${String(fromBanner)}, GET says ${String(fromGet)}`);
      }
    }
  }

  const tokens = Object.fromEntries(CAPABILITY_TOKENS.map((k) => [k, tokenAnswer(answer(k), k, conflicts)])) as Record<
    CapabilityToken,
    TokenAnswer
  >;
  const spph = spphAnswer(answer(SPINDLE_PAUSE_TOKEN));

  const fbs = buildHash(answer(BUILD_HASH_TOKEN), conflicts);
  const bannerFbs = obs.banner?.fbs;
  if (obs.banner !== undefined && bannerFbs !== fbs) {
    conflicts.push(`fbs: banner says ${String(bannerFbs ?? 'none')}, GET says ${String(fbs ?? 'none')}`);
  }
  const footers: Footer[] = [];
  if (obs.banner?.footer !== undefined) footers.push(obs.banner.footer);
  for (const step of steps) footers.push(answer(step.key).footer);
  const result: ProbeResult = Object.freeze({
    banner: obs.banner?.shape ?? 'none',
    footerRev: footerRev as 1 | 2 | 3,
    ...identity,
    tokens: Object.freeze(tokens),
    spph,
    ...(fbs === undefined ? {} : { fbs }),
    footers: Object.freeze(footers),
    conflicts: Object.freeze(conflicts),
  });
  return { ok: true, result };
}

/** The value of `key` when `r` holds exactly that one key (one key per line, PN §4). */
function singleValue(r: Response, key: string): JsonValue | undefined {
  const keys = Object.keys(r.r);
  return keys.length === 1 && keys[0] === key ? r.r[key] : undefined;
}

function assignIdentity(out: IdentityValues, key: IdentityToken, value: JsonValue): boolean {
  switch (key) {
    case 'fb':
    case 'fv':
      if (typeof value !== 'number') return false;
      out[key] = value;
      return true;
    case 'hp':
    case 'hv':
      // A number on TinyG, a string on g2core (OLD-PN §2.2).
      if (typeof value !== 'number' && typeof value !== 'string') return false;
      out[key] = value;
      return true;
    case 'id':
      if (typeof value !== 'string') return false;
      out.id = value;
      return true;
  }
}

/**
 * The build hash, or undefined when the board answered 100 (it reports
 * none). Any other answer (another status, a non-string or empty value) is a
 * conflict: it is neither a hash nor a clean "no such token".
 */
function buildHash(r: Response, conflicts: string[]): string | undefined {
  if (r.footer.status === PROBE_STATUS.UNRECOGNIZED) return undefined;
  const value = singleValue(r, BUILD_HASH_TOKEN);
  if (r.footer.status === PROBE_STATUS.OK && typeof value === 'string' && value.length > 0) return value;
  conflicts.push(`fbs: neither a build hash nor unrecognised (status ${r.footer.status})`);
  return undefined;
}

/**
 * How a capability token answered. A status-0 answer counts as `value` only
 * when the value is one the edge-next firmware can print for that token
 * (P0-08 review): a corrupt or foreign value must not prove the contract
 * that enables control. A status-0 answer with any other value is `other`
 * and a conflict, so the board stays READ_ONLY whatever else it answered.
 */
function tokenAnswer(r: Response, key: CapabilityToken, conflicts: string[]): TokenAnswer {
  if (r.footer.status === PROBE_STATUS.UNRECOGNIZED) return 'unrecognized';
  if (r.footer.status !== PROBE_STATUS.OK) return 'other';
  const value = singleValue(r, key);
  if (value !== undefined && CAPABILITY_VALUE_VALID[key](value)) return 'value';
  conflicts.push(`${key}: status 0 with a value edge-next never reports (${value === undefined ? 'none' : JSON.stringify(value)})`);
  return 'other';
}

/** A uint8 setting whose setter refuses anything above 1 (@cite EN config.c:446-451 `set_01`). */
const isZeroOrOne = (v: JsonValue): boolean => Object.is(v, 0) || v === 1;

/**
 * `fstk` is the lowest unused-stack watermark: a count of painted bytes from
 * `__heap_start` up to SP, printed as an unsigned integer (@cite EN
 * stack_report.c:47-58; util.c:366-376 `%lu`). Both ends lie in the
 * atxmega192a3's 16 KB internal SRAM, 0x2000-0x5FFF (@cite EN Makefile:14),
 * so the count is at most 0x5FFF - 0x2000 = 16383.
 */
export const FSTK_MAX = 0x5fff - 0x2000;

/**
 * The values edge-next can print for each capability token (@cite EN
 * config_app.c:649-667): `spep` (spindle.c:64), `prbp` (switch.c:319) and
 * `os` (`set_01`) are 0 or 1; `fstk` is an integer 0..FSTK_MAX.
 */
const CAPABILITY_VALUE_VALID: Readonly<Record<CapabilityToken, (v: JsonValue) => boolean>> = Object.freeze({
  spep: isZeroOrOne,
  prbp: isZeroOrOne,
  os: isZeroOrOne,
  // -0 is excluded: `%lu` never prints it.
  fstk: (v: JsonValue) => typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= 0 && v <= FSTK_MAX,
});

function spphAnswer(r: Response): SpphAnswer {
  if (r.footer.status === PROBE_STATUS.STUBBED) return 'stubbed';
  if (r.footer.status === PROBE_STATUS.UNRECOGNIZED) return 'unrecognized';
  if (r.footer.status === PROBE_STATUS.OK && singleValue(r, SPINDLE_PAUSE_TOKEN) !== undefined) return 'value';
  return 'other';
}
