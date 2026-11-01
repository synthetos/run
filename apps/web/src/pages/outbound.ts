/**
 * Every link from run.synthetos.com to another website (ROADMAP P0-05).
 *
 * The bundle scan (tools/gates/src/bundle/scan.ts) refuses any URL of another
 * origin in the built bundle, except these exact URLs, and only as the
 * `href` of an `<a>` in a prerendered HTML page. A link is top-level
 * navigation that the user chooses; it loads nothing into this page. Keep
 * these out of anything that ships in JavaScript.
 *
 * Adding a URL here is a reviewed change to what the scan allows.
 */
export const OUTBOUND = Object.freeze({
  /** Chrome Help: "Always keep these sites active" (Memory Saver exceptions). */
  chromeKeepActive: 'https://support.google.com/chrome/answer/12929150',
  /** Private vulnerability reporting for the synthetos/run repository (SECURITY.md). */
  reportVulnerability: 'https://github.com/synthetos/run/security/advisories/new',
  /** The repository's security policy. */
  securityPolicy: 'https://github.com/synthetos/run/security/policy',
  /** The Synthetos website. */
  synthetos: 'https://synthetos.com/',
});

export const OUTBOUND_URLS: readonly string[] = Object.freeze(Object.values(OUTBOUND));
