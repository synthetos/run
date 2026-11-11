/**
 * The capability classifier (ROADMAP P0-08; PN §2.3 classification table;
 * SAFETY H44, T-S55).
 *
 * `classify(probe, manifest)` decides which dialect a board speaks and
 * whether the session may be full or must be READ_ONLY. A board is never
 * classified by `fb` alone: stock edge-0.97 reported the same 449.01 that
 * edge-next used to, and although edge-next now reports 450.01 (D4 done),
 * `make FW_BUILD=x.y` sets any number and no build reports `fbs` yet. The
 * capability tokens and `spph` answer prove edge-next; the signed manifest
 * approves the exact build.
 *
 * Rows, first match wins (PN §2.3):
 *
 * | Condition | Result |
 * |---|---|
 * | any conflict in the probe, or TinyG and g2core signals together | unclassified, READ_ONLY |
 * | footer rev 2/3, `fv` 0.97, `hp` 1, all four capability tokens answer, `spph` stubbed | `tinyg-en`: full if the manifest approves (`fb`, `fbs` from the probe's GET), else READ_ONLY "not approved" |
 * | footer rev 1, `fv` 0.97, `hp` 1, `fb` 440.21, no capability token, `spph` unrecognised | `tinyg-440`: full if the manifest approves (D22, HIL-6.1), else READ_ONLY |
 * | footer rev 2/3, `fb` 449.xx, no capability token, `spph` unrecognised | `tinyg-449-stock`, always READ_ONLY, upgrade offer (D23) |
 * | `hp` a string or `fv` 0.99, footer rev 1, `fb` 101.06 | `g2core-edge`, READ_ONLY until Phase 7 |
 * | `hp` a string or `fv` 0.99, any other build | unclassified g2core, READ_ONLY |
 * | anything else | unclassified, READ_ONLY |
 *
 * The banner shape, when a banner was seen, must be the dialect's own. A
 * READ_ONLY dialect is READ_ONLY whatever the manifest says.
 *
 * Every footer the probe collected (each answer and an `r-footer` banner)
 * must also meet the matched dialect's footer contract (`footerFitsDialect`:
 * a revision it prints, and a checksum exactly when it always prints one).
 * A board that matches a row on everything else but fails this is
 * unclassified with the offending footers in the detail (P0-08 review): a
 * 440.21 answer without its checksum is not 440.21, or not intact.
 *
 * "Unclassified" returns `dialect: null` (a deviation from RUN_PLAN §5.5,
 * which types `dialect` as always present): there is no honest dialect for a
 * board that matches no row, and the session must then use the unclassified
 * rules (`!` only plus "Use your E-stop", `stopJobFor(null, ...)`).
 */
import type { ApprovedBuild, ApprovedBuilds } from '../approvedBuilds.ts';
import { findApproval } from '../approvedBuilds.ts';
import { CAPABILITY_TOKENS } from '../probe.ts';
import type { ProbeResult, TokenAnswer } from '../probe.ts';
import { G2CORE_EDGE } from './g2core.ts';
import { footerFitsDialect } from './lookup.ts';
import { TINYG_440 } from './tinyg440.ts';
import { TINYG_449_STOCK } from './tinyg449Stock.ts';
import { TINYG_EN } from './tinygEn.ts';
import type { Dialect } from './types.ts';

export type ClassifyReason =
  | 'en-approved'
  | 'en-not-approved'
  | 'tg440-approved'
  | 'tg440-not-approved'
  | 'stock-449'
  | 'g2core-read-only'
  | 'g2core-unknown-build'
  | 'conflict';

export interface Classification {
  /** The dialect, or null when the board matches no row (unclassified). */
  readonly dialect: Dialect | null;
  readonly mode: 'full' | 'readOnly';
  readonly reason: ClassifyReason;
  /** A plain explanation with the probed values, for the log and the READ_ONLY banner. */
  readonly detail: string;
  /** Offer a firmware upgrade (D23; stock 440.21 too, PN §2.1). */
  readonly upgradeOffer: boolean;
  /** The manifest entry that approved a full session. */
  readonly approval?: ApprovedBuild;
  /**
   * How a full session's build was identified: `fbs` (the probe read a build
   * hash the manifest names) or `fbOnly` (an fbs-null bench entry: any build
   * reporting this `fb` matches; the UI must show that).
   */
  readonly buildIdentity?: 'fbs' | 'fbOnly';
  /** Where a full session's approval came from (absent: the signed manifest). */
  readonly approvalSource?: 'release-list' | 'trusted';
}

/** TinyG builds report fv 0.97 (@cite EN tinyg.h:54; TG tinyg.h:52). */
const TINYG_FV = 0.97;
/** g2core reports fv 0.99 (@cite G2 g2core_info.h:25). */
const G2_FV = 0.99;
/** HW_PLATFORM_TINYG_XMEGA (@cite EN hardware.h:56; TG hardware.h:56). */
const TINYG_HP = 1;
/** The only 440.xx build with a dialect (PN §2.1; @cite TG tinyg.h:48). */
const TG_FALLBACK_FB = 440.21;
/** The g2core build `g2core-edge` describes (@cite G2 g2core_info.h:24). */
const G2_EDGE_FB = 101.06;

export function classify(p: ProbeResult, manifest: ApprovedBuilds): Classification {
  const conflicts = [...p.conflicts];
  const tinygSignal = typeof p.hp === 'number' || p.fv === TINYG_FV || (p.fb !== undefined && p.fb >= 400);
  const g2Signal = typeof p.hp === 'string' || p.fv === G2_FV || (p.fb !== undefined && p.fb >= 100 && p.fb < 103);
  if (tinygSignal && g2Signal) conflicts.push('both TinyG and g2core identity signals');
  if (conflicts.length > 0) return unclassified('conflict', `conflicting probe answers: ${conflicts.join('; ')}`);

  const tokensAll = (answer: TokenAnswer): boolean => CAPABILITY_TOKENS.every((t) => p.tokens[t] === answer);
  const fits = (d: Dialect): boolean =>
    d.caps.footerRevs.includes(p.footerRev) && (p.banner === 'none' || p.banner === d.bannerShape);
  // Checked once a row matches on everything else, so a failure names the dialect it fails.
  const footerViolation = (d: Dialect): Classification | undefined => {
    const footers = Array.isArray(p.footers) ? p.footers : [];
    const bad = footers.filter((f) => !footerFitsDialect(d, f));
    if (footers.length > 0 && bad.length === 0) return undefined;
    const evidence = footers.length === 0 ? 'no footers recorded' : bad.map((f) => JSON.stringify(f.raw)).join(', ');
    return unclassified('conflict', `matches ${d.label} except its footer contract (${evidence}): read-only`);
  };

  // Edge-next: all capability probes still required. E060 gives spph a real value from 450.04.
  const holdProbeFits = p.fb !== undefined && p.fb >= 450.04 ? p.spph === 'value' : p.spph === 'stubbed';
  if (fits(TINYG_EN) && p.fv === TINYG_FV && p.hp === TINYG_HP && tokensAll('value') && holdProbeFits) {
    return footerViolation(TINYG_EN) ?? approvable(TINYG_EN, p, manifest, 'en-approved', 'en-not-approved');
  }

  const noCapabilityTokens = tokensAll('unrecognized') && p.spph === 'unrecognized';

  if (fits(TINYG_440) && p.fv === TINYG_FV && p.hp === TINYG_HP && p.fb === TG_FALLBACK_FB && noCapabilityTokens) {
    return footerViolation(TINYG_440) ?? approvable(TINYG_440, p, manifest, 'tg440-approved', 'tg440-not-approved');
  }

  // Stock edge-0.97. `hp` is not checked: it is unreliable there (E104). (A g2 signal with this fb
  // already returned as a conflict above.)
  if (fits(TINYG_449_STOCK) && p.fb !== undefined && p.fb >= 449 && p.fb < 450 && noCapabilityTokens) {
    const violation = footerViolation(TINYG_449_STOCK);
    if (violation !== undefined) return violation;
    return {
      dialect: TINYG_449_STOCK,
      mode: 'readOnly',
      reason: 'stock-449',
      detail: `stock TinyG edge-0.97 (fb ${p.fb}) has no edge-next capability tokens: read-only, upgrade recommended`,
      upgradeOffer: true,
    };
  }

  if (g2Signal) {
    if (fits(G2CORE_EDGE) && p.fb === G2_EDGE_FB) {
      const violation = footerViolation(G2CORE_EDGE);
      if (violation !== undefined) return violation;
      return {
        dialect: G2CORE_EDGE,
        mode: 'readOnly',
        reason: 'g2core-read-only',
        detail: `g2core ${p.fb} is read-only until g2 control ships`,
        upgradeOffer: false,
      };
    }
    return unclassified('g2core-unknown-build', `g2core build ${describe(p.fb)} (footer rev ${p.footerRev}) has no dialect`);
  }

  return unclassified('conflict', `no dialect matches fb ${describe(p.fb)}, footer rev ${p.footerRev}`);
}

function approvable(
  dialect: Dialect,
  p: ProbeResult,
  manifest: ApprovedBuilds,
  approved: ClassifyReason,
  notApproved: ClassifyReason,
): Classification {
  const upgradeOffer = dialect.upgradeOffer;
  // Only called for dialects whose mode is `manifest`; the manifest parser also refuses entries for
  // READ_ONLY dialects, so a manifest can never lift tinyg-449-stock or g2core out of READ_ONLY.
  const approval = findApproval(manifest, dialect.id, p.fb, p.fbs, { hv: p.hv, id: p.id });
  const build = `fb ${describe(p.fb)}${p.fbs === undefined ? '' : ` (${p.fbs})`}`;
  if (approval === undefined) {
    return {
      dialect,
      mode: 'readOnly',
      reason: notApproved,
      detail: `this ${dialect.label} build (${build}) is not approved for this environment: read-only`,
      upgradeOffer,
    };
  }
  // The probe cannot read the commit. Without fbs it cannot even tell builds that share this fb apart,
  // so the manifest's commit is not shown as if it identified the board (D4, P0 review).
  const identity =
    approval.source === 'trusted'
      ? `custom firmware you trusted on this board (image sha256 ${(approval.imageSha256 ?? '').slice(0, 12)}); not a signed build`
      : approval.fbs === null
        ? 'commit not verifiable: the build reports no fbs, so every build reporting this fb matches (bench only)'
        : `identified by fbs; manifest commit ${approval.commit.slice(0, 8)}`;
  const where = approval.source === 'trusted' ? 'by you on this board' : approval.source === 'release-list' ? `as a signed release on the ${approval.channel} channel` : `on the ${approval.channel} channel`;
  return {
    dialect,
    mode: 'full',
    reason: approved,
    detail: `${dialect.label} ${build}, approved ${where} (${identity})`,
    upgradeOffer,
    approval,
    buildIdentity: approval.fbs === null ? 'fbOnly' : 'fbs',
    ...(approval.source === undefined ? {} : { approvalSource: approval.source }),
  };
}

function unclassified(reason: ClassifyReason, detail: string): Classification {
  // No upgrade offer: nothing is known about what the board is, so no image can be recommended.
  return { dialect: null, mode: 'readOnly', reason, detail, upgradeOffer: false };
}

function describe(fb: number | undefined): string {
  return fb === undefined ? 'unknown' : String(fb);
}
