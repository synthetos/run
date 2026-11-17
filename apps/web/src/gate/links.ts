/**
 * The sign-in front door's links to other sites. The bundle scan (tools/gates/src/bundle/scan.ts) admits these
 * exact URLs as whole string literals in a JavaScript chunk, under the same reviewed prefixes as the report
 * destinations; anything else of another origin in a chunk is refused. Adding a URL here is a reviewed change to
 * what the scan allows. "What we store" joins when accounts publishes its privacy page (spec §5.2).
 */
export const OVERVIEW_HREF = 'https://github.com/synthetos/run#readme';

export const GATE_URLS: readonly string[] = Object.freeze([OVERVIEW_HREF]);
