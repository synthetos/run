/**
 * Which paths need the SAFETY §8 review (ROADMAP P0-03).
 *
 * SAFETY §8: the checklist is "required on every PR that touches `machine`,
 * `protocol`, `safety`, `flasher`, `schema` (allowlists and schemas),
 * `testkit` device models, jog/control/firmware UI, the run Worker headers,
 * or any code that moves data between `cloud` and the machine path", and a
 * second reviewer signs the "Safety review" approval.
 *
 * A PR touching any of these paths must carry the completed checklist from
 * `.github/pull_request_template.md` and a recorded independent review, plus
 * the approvals tools/gates/src/review/reviewPolicy.ts requires (D40: none
 * while there is a single maintainer, two once a second one joins).
 * The list is deliberately broad: a false positive costs a checklist, a
 * false negative skips a safety review. When a later task adds a directory
 * that belongs here (a jog panel, the job loader, the profile-diff module),
 * it adds the path in the same PR.
 *
 * Patterns use CODEOWNERS semantics (shared/glob.ts).
 */
export const SAFETY_REVIEW_PATHS: readonly string[] = [
  // The machine path and its data (SAFETY §8 first paragraph).
  '/packages/machine/',
  '/packages/protocol/',
  '/packages/safety/',
  '/packages/flasher/',
  '/packages/schema/',
  '/packages/testkit/',
  // Jog, control and firmware UI, and the workers that own the port.
  '/apps/web/src/panels/jog/',
  '/apps/web/src/panels/control/',
  '/apps/web/src/panels/firmware/',
  '/apps/web/src/workers/',
  // Data that moves between the cloud client and the machine path.
  '/apps/web/src/cloud/',
  '/apps/web/src/loaders/',
  // The run Worker headers and everything that carries them (RUN_PLAN §6.4,
  // T-S25, SAFETY H45, D39; ROADMAP P0-04).
  '/workers/run/src/headers.ts',
  '/workers/run/wrangler.jsonc',
  '/apps/web/public/_headers',
  '/apps/web/src/security/',
  // Safety data and documents (SAFETY §8 CODEOWNERS list, ROADMAP P0-03).
  '/SAFETY.md',
  '/safety-advisory.json',
  '/firmware/',
  '/vendor/tinyg-hil-tables/',
  // The gates that enforce the boundaries above, and the supply chain.
  '/.github/',
  '/.dependency-cruiser.cjs',
  '/eslint.config.js',
  '/tools/gates/',
  '/apps/web/build/',
  '/apps/web/vite.config.ts',
  '/ci/',
  '/pnpm-lock.yaml',
  '/pnpm-workspace.yaml',
  '/.npmrc',
];
