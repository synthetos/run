# The run Worker, its headers and its deploys

ROADMAP P0-04, RUN_PLAN §5.2, §6.3, §6.4, SAFETY H45, H46, T-S25.

## What serves what

| Path | Served by | Headers from |
|---|---|---|
| `/`, `/404.html`, `/assets/*`, `/licenses/*` and every other static path | the Workers **asset layer**, without running the Worker (`html_handling: auto-trailing-slash`, `not_found_handling: 404-page`) | `apps/web/public/_headers`, copied into the build |
| `/api/*`, `/auth/*` | the Worker first (`run_worker_first`) | `withSecurityHeaders()` in `workers/run/src/headers.ts` |

Both carry the same headers because both come from one module:
`workers/run/src/headers.ts`. `_headers` is generated from it
(`pnpm gen:headers`) and is checked three times: a unit test compares the
committed file byte for byte, the bundle scan refuses a build whose
`_headers` is missing or different, and the Playwright suite reads the
headers off real responses. `_headers` never applies to Worker responses,
and the Worker never sees asset requests, so neither mechanism alone would
cover everything (https://developers.cloudflare.com/workers/static-assets/headers/).

Phase 0 routes: `GET`/`HEAD /api/health` returns
`{"status":"ok","service":"run","env":"<RUN_ENV>","version":"…"}` with
`Cache-Control: no-store`; an unknown `RUN_ENV` returns 500 `misconfigured`.
Every other `/api/*` and `/auth/*` path is a JSON 404. An uncaught error is a
500 that still carries the headers.

`workers_dev: false` and `preview_urls: false` are set explicitly at the top
level and in `env.staging` (H45: every extra hostname is a separate origin
with its own serial grant). `tools/gates/src/deploy/wranglerConfig.ts` checks
these and the rest of the configuration in the unit tests and again in the
deploy preflight.

## Local

```
pnpm build                                  # apps/web/dist
pnpm --filter @synthetos/run-worker dev     # wrangler dev, http://localhost:8787
node tools/gates/src/smoke/cli.ts --base-url http://localhost:8787
pnpm e2e                                    # build, then Playwright against wrangler dev
pnpm e2e:artifact                           # the CI e2e job: artifact, suite, canary
```

`pnpm e2e` (tools/e2e) needs a Chromium for Playwright
(`node_modules/.bin/playwright install chromium`). It asserts:
- the exact header set, once each, on the shell, every subresource, the 404
  page, `/api/health` and the other `/api` and `/auth` paths;
- the shell renders with zero CSP violations and zero console errors, the
  self-hosted Plex faces load, and no request leaves the origin (the
  origin guard checks this for every test, see docs/ops/ci.md);
- an inline `<script>` added to the built page is blocked with a
  `script-src-elem` violation (and, as a control, runs when the CSP header
  is removed);
- no Trusted Types policy can be created after start-up (both names are
  claimed by `apps/web/src/security/tt.ts`; `default` and others are
  refused), and HTML and script-URL sinks refuse plain strings;
- Permissions-Policy allows `serial` for the page and denies the other
  device APIs.

The CI `e2e` job (P0-06) runs this suite against the attested artifact;
see docs/ops/ci.md, "The e2e job".

## The artifact

The `build` job builds the Worker twice with
`tools/gates/src/build/worker-cli.ts` and compares the outputs, as it does
for the web bundle. The builder erases TypeScript types with Node's own
`stripTypeScriptTypes` and rewrites `./x.ts` imports to `./x.mjs`; it
refuses npm, parent-directory and dynamic imports. When the Worker starts
importing `contracts` (A1) the builder will refuse, and the Worker must move
to a bundler inside the build toolchain. The artifact is `run-web.tar` and
`run-worker.tar`, each with a sha256 manifest, all four attested.

## A deploy, step by step

`deploy-staging`, then `deploy-production` (owner approval):
1. Check the four downloaded files against the sha256 the `build` job
   published as its outputs (artifact poisoning, P0 review), then verify the
   attestation of all four and the extracted trees.
2. **Preflight** (`deploy/preflight.ts`): the configuration passes every
   check; `account_id` is a real account id, not the D34 placeholder; it
   equals the `CLOUDFLARE_ACCOUNT_ID` variable.
3. Staging only: **Access must already be in front** (`smoke/cli.ts --env
   staging --pre-deploy`): a positive check through the Cloudflare Access
   API (docs/ops/access.md §2); "not reachable" alone never passes.
4. **Previous state**: the newest `run-deployed-<env>` artifact from a `push`
   run of `ci.yml` on `main` in this repository (`deploy/previous.ts`; a pull
   request run can never qualify). None means a first deploy, with a warning.
   The state is only a claim (any job of such a run could upload that
   name), so for every commit it names the job finds that commit's `ci.yml`
   push run, downloads its `run-web` artifact and `gh attestation verify`s
   the `run-web.sha256` manifest (signer workflow, `main`, source digest =
   that commit).
5. **Asset retention** (`deploy/retention.ts`): hashed `assets/**` files that
   stopped being current less than 14 days ago are merged into the site.
   Refused: state from the other environment, a file whose bytes do not
   match the recorded hash, a hashed name with different bytes in the new
   build, timestamps in the future, and a retained file that the attested
   manifest of its commit does not list with the same sha256. A file whose
   commit has no verified manifest is dropped. Only `assets/**` names with a
   content hash and a `js`, `css`, `woff2` or `png` extension are ever
   retained: never HTML, SVG, XML, text or `_headers`. The merged tree is
   scanned again.
6. `wrangler deploy worker/index.mjs --no-bundle --assets deploy-site`
   (100%, never gradual).
7. **Smoke test** (`smoke/cli.ts --env <env>`):
   - production: the shell, its entry script, a 404 and `/api/health` with
     the exact headers; staging: anonymous `/` and `/api/health` are sent to
     the Access login (the deploy job holds no Access credential, and the
     same artifact's headers are checked in production);
   - both: workers.dev and preview URLs off (Cloudflare API) and the
     workers.dev hostname dead (probe); DNSSEC validated by two resolvers;
     a CAA record naming only the allowed CAs; the certificate issuer.
   Any finding fails the job, so a header regression on staging stops the
   production deploy, and one on production fails visibly. **A failure after
   the deploy step undoes the deploy** (`deploy/rollback-cli.ts`): staging is
   deleted, production rolled back (docs/ops/access.md §2).
8. Upload `run-deployed-<env>` (`retention.json` plus every asset it lists)
   for the next deploy.

Rollback is `wrangler rollback` from the dashboard by the owner, plus a
`safety-advisory.json` revocation (RUN_PLAN §6.3, later phases).

## Acceptance items that need the owner

- Production serving the shell, and staging reachable only through Access:
  the manual check in docs/ops/access.md §3, recorded in the PR.
- "The smoke script fails the deploy job on a header regression (tested by
  a deliberately broken header in a test deployment)". Locally this is
  proven by `tools/gates/test/smoke.test.ts`: the real CLI against a server
  that breaks one header at a time, on the shell, an asset, the 404 page and
  `/api/health`. The deployed drill needs an owner decision, because deploys
  run only from `main` and staging is behind Access:
  - **Option A (recommended):** create an Access service token for the
    smoke test, add a policy rule that admits it on staging, and allow the
    deploy jobs one more secret pair for it (a reviewed change to
    `tools/gates/src/workflow/policy.ts`, which today allows only
    `CLOUDFLARE_API_TOKEN`). The staging smoke then checks the full header
    set too, and the drill is: merge a commit to `main` that changes one
    value in `headers.ts` and regenerates `_headers`, watch `deploy-staging`
    fail at the smoke step (so production is never deployed), revert.
  - **Option B:** run the same drill through production: approve the
    production deploy of the broken commit, record the failing smoke step,
    and roll back at once. The window is short, but production briefly
    serves a weakened header.
  Record the chosen option and the failing run URL in the P0-04 PR.
