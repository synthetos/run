# CI, the attested artifact and the deploy gate

ROADMAP P0-03, RUN_PLAN §6.2, SAFETY H12 and H46. The workflow is
`.github/workflows/ci.yml`. The pull-request review check is
`.github/workflows/safety-review.yml`.

## Jobs

| Job | Runs on | Holds | What it does |
|---|---|---|---|
| `verify` | every PR and every push to `main` | no secret, `contents: read` | Full install (`--frozen-lockfile --ignore-scripts`), then typecheck, lint, dependency-cruiser, licence gate, CI policy (`pnpm ci-policy`), unit tests |
| `build` | every PR and push | no secret, `contents: read` | Two clean checkouts (`a/`, `b/`). In each one it installs **only the production build toolchain** from a lockfile subset, then builds the web bundle and the Worker script (`tools/gates/src/build/worker-cli.ts`, P0-04). It fails unless the two `dist/` trees, and the two Worker builds, are byte-identical. Then it runs the bundle scan and uploads the artifact `run-web` (`run-web.tar`, `run-worker.tar` and their `.sha256` manifests) |
| `e2e` | every PR and push | no secret, `contents: read` | Downloads the artifact and checks it against its manifests, then runs the Playwright suite against `wrangler dev` serving **that artifact** under the origin guard (T-S25), then the third-party canary. See "The e2e job" below |
| `e2e-fake-serial` | every PR and push | no secret, `contents: read` | Builds the fake-serial TEST artifact from the same commit (before anything else lands in the checkout), downloads and verifies the production site, proves the two differ only in the transport seam chunk (`tools/gates/src/artifact/diff-cli.ts`), then runs the fake-serial Playwright suite against the test artifact. Uploads nothing; the test build is never attested or deployed. See docs/testing/fake-serial.md (P0-14) |
| `attest` | push to `main` only | `id-token: write`, `attestations: write` | Signs SLSA build provenance for `run-web.tar`, `run-worker.tar` and their manifests with `actions/attest-build-provenance`. It checks out no code and runs none |
| `deploy-staging` | push to `main` only, and only when `vars.RUN_DEPLOY_ENABLED == 'true'` | environment `staging`, `CLOUDFLARE_API_TOKEN` | Installs wrangler from `ci/deploy-toolchain` (pinned by version and integrity, `--ignore-scripts`). Verifies the attestation (`gh attestation verify`: this repository, this workflow, `refs/heads/main`, this commit, GitHub-hosted runner). Checks the extracted trees against the manifests. Runs the preflight (D34 account, H45 settings) and the Access pre-check, merges the hashed assets of the last 14 days, deploys the attested Worker with `--no-bundle`, runs the smoke test and keeps the deployed state for the next deploy (docs/ops/worker.md). Holds `actions: read` to find the previous deployment's state |
| `deploy-production` | as staging, after staging succeeds | environment `production` (the owner is a required reviewer), `CLOUDFLARE_API_TOKEN` | The same steps, deploying the **same** attested artifact to production. It promotes the artifact and never rebuilds it |

Every action is pinned to a full commit SHA. The tag is kept in a comment
next to it. No job uses `pull_request_target` or `workflow_run`, so pull
requests from forks run only the secret-free jobs.

### Why the deploy jobs cannot run on a pull request

- Each deploy job's `if:` is a plain conjunction of equalities:
  `github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.RUN_DEPLOY_ENABLED == 'true'`.
  It is false for every `pull_request` event, whatever the branch.
  `tools/gates/test/workflow-policy.test.ts` evaluates it against pull
  request contexts.
- The first step of each deploy job checks `GITHUB_EVENT_NAME` and
  `GITHUB_REF` again at run time and fails if either is wrong.
- The `staging` and `production` environments allow deployments from `main`
  only (an owner setting, see branch-protection.md). The token is an
  **environment** secret, so no job without the environment can read it.
- `pnpm ci-policy` fails the `verify` job if any of this changes:
  - a deploy condition loses a term or gains `||`, `!` or a function;
  - a deploy job stops needing `verify`, `build`, `e2e`, `e2e-fake-serial` and `attest`;
  - another job names an environment;
  - anything other than the deploy jobs mentions `secrets` or `CLOUDFLARE_API_TOKEN`.

**Proof in the logs** (ROADMAP acceptance, needs the GitHub repository).
Open any PR. The run summary lists `attest`, `deploy-staging` and
`deploy-production` as **skipped**. Save the run URL in the P0-03 PR.

## The e2e job (P0-06)

ROADMAP P0-06: "the `e2e` job runs Playwright against `wrangler dev` serving
the attested artifact, intercepts requests to assert no external origins,
and runs the header tests. Acceptance: T-S25 passes in CI. A third-party URL
in a built page fails the job."

1. **Install.** A full frozen, script-free install (the job holds no secret
   and uploads nothing, so test tools here cannot reach the artifact the
   deploy jobs use), then Chromium through `playwright install --with-deps`.
2. **The artifact.** It downloads `run-web`, extracts `run-web.tar` to
   `site/` and `run-worker.tar` to `worker/`, and verifies both against
   their manifests. These are the bytes `attest` signs and the deploy jobs
   deploy.
3. **The suite** (`pnpm --filter @synthetos/e2e e2e`). The job-level env
   sets `RUN_E2E_SITE` and `RUN_E2E_WORKER`, which put the suite in
   **artifact mode** (`tools/e2e/src/served.ts`): `wrangler dev
   worker/index.mjs --no-bundle --assets site --config
   workers/run/wrangler.jsonc`, the deploy command with `dev` for `deploy`.
   Setting only one of the two is refused. `served-bytes.e2e.ts` checks that
   every file of `site/` is served unchanged, so the header, CSP and Trusted
   Types results hold for exactly these bytes.
4. **The origin guard** (`tools/e2e/src/guard.ts`) is installed on every
   test's browser context by `specs/fixtures.ts`. ESLint refuses a spec that
   imports `test` straight from Playwright, so no test runs without it. It
   fails the test on any request or WebSocket to another origin (and aborts
   it, so nothing reaches a third party even from CI), on any
   resource-loading attribute in a document that points to another origin
   (including `dns-prefetch` and `preconnect` hints, which never become
   requests), and on any CSP violation the test did not declare.
   `origin-guard.e2e.ts` proves each layer in every run.
5. **The canary** (`pnpm --filter @synthetos/e2e canary`,
   `tools/e2e/src/canary.ts`). It copies `site/` to a temporary directory,
   plants a third-party URL in each built page (an image in `/`, a
   stylesheet in `/safety/`, a script in `/privacy/`, a dns-prefetch hint in
   the 404 page; all under `.invalid`), runs the whole suite against the copy
   with the artifact's Worker, and **passes only if the suite fails and the
   origin guard names every planted URL**. A canary run that passes, or that
   fails for another reason (wrangler did not start), fails the job. This is
   the acceptance "a third-party URL in a built page fails the job", checked
   on every run rather than once.

The policy rule `e2e-job` keeps this shape: no `if:`, `needs: [build]`, the
two env values (named nowhere else in the job, so no step can point the
suite elsewhere), the manifest checks, then the suite, then the canary.

Locally, `pnpm e2e:artifact` does the same: it builds, assembles an
artifact in a temporary directory (copies instead of tar files), verifies
it, runs the suite in artifact mode and runs the canary.

## The CI policy (`pnpm ci-policy`)

`tools/gates/src/workflow/policy.ts` reads every workflow file. It allows a
restricted, block-style subset of YAML and fails closed on anything it
cannot follow: anchors, aliases, merge keys and tabs. It enforces:

| Rule | Meaning |
|---|---|
| `secret-outside-deploy` | Only the deploy jobs mention `secrets` or the token, and they may use only `secrets.CLOUDFLARE_API_TOKEN`. `secrets: inherit`, `secrets[...]` and `toJSON(secrets)` are refused everywhere |
| `deploy-gate` | The deploy condition, the `needs` list and the protected environment are as described above |
| `environment-outside-deploy` | No other job uses an environment |
| `unpinned-action` | Every `uses:` names a full 40-character commit SHA |
| `banned-trigger` | No `pull_request_target`, no `workflow_run` |
| `expression-in-run` | No `${{ }}` inside a `run:` script. Values arrive through `env:`, so a PR title or branch name can never become shell code |
| `write-permission` | Top-level permissions are read-only. Only `attest` may hold `id-token: write` and `attestations: write`. `write-all` is refused |
| `continue-on-error` | Refused, so a failing gate always fails the run |
| `verify-job` | `ci.yml` runs on `pull_request`, and `verify` is unconditional and runs `pnpm -r test` |
| `fake-serial-job` | `e2e-fake-serial` is unconditional, needs `build`, builds the test artifact before downloading anything, verifies the production site, runs the artifact diff, then the fake-serial suite; uploads nothing; never names `RUN_E2E_SITE`/`RUN_E2E_WORKER` |
| `e2e-job` | `e2e` is unconditional, needs `build`, serves the extracted artifact (job-level `RUN_E2E_SITE`, `RUN_E2E_WORKER`, named nowhere else in the job), verifies it, then runs the suite, then the canary |

`pnpm ci-policy` also runs two more checks:
- **CODEOWNERS** (`tools/gates/src/codeowners`):
  - every path in the in-repo `SAFETY.md` §8 list, plus
    `vendor/tinyg-hil-tables/**` and `pnpm-lock.yaml`, is listed and owned by
    the owner;
  - no later line takes any of them away (in CODEOWNERS the last matching
    line wins);
  - no line is one that GitHub would silently ignore.
- **PR template** (`tools/gates/src/review/template.ts`): the template has
  items 1–40 unticked, and items 22–40 match `SAFETY.md` §8 verbatim.

## The minimal build toolchain

All test, lint and boundary tools are devDependencies of the workspace
root, and pnpm always installs the root, even under `--filter`. So
`tools/gates/src/build/cli.ts install <checkout>` does four things:
1. It empties the root importer, in `package.json` (no devDependencies) and
   in `pnpm-lock.yaml` (`.: {}`). Every other lockfile line stays the same,
   including every integrity hash.
2. It runs `pnpm install --frozen-lockfile --ignore-scripts --filter @synthetos/web...`.
3. It restores both files byte for byte.
4. It fails if the store contains any root devDependency, or any
   devDependency of a workspace package outside the build (wrangler, for
   example). Type-only `@types/*` packages are allowed.

The result is vite and its closure, preact, `@preact/signals` and nothing
else (23 packages today). The build toolchain is therefore the web app's
devDependencies (`vite`). Do not add a build-time tool anywhere else.

## Reproducibility

The two builds run in different directories, so an absolute path, a
timestamp or any other non-determinism makes the comparison fail. Two
settings in the web config matter here:
- `apps/web/vite.config.ts` refuses to build under any `NODE_ENV` other than
  unset or `production`. Vite keeps a preset `NODE_ENV`, and a development
  bundle embeds absolute source paths. The reproducibility test caught this
  under vitest's `NODE_ENV=test`.
- The JSX runtime is pinned to `development: false`.

`pnpm repro` runs the same check locally: it clones `HEAD` twice, installs
the subset, builds both, compares them and runs the scan.

## The bundle scan

`tools/gates/src/bundle/scan.ts` (`pnpm scan`, and the `build` job). It fails
on any of these:
- any `scheme://` origin literal, except:
  - the XML namespace URIs, by exact match;
  - run's own origins, and only inside `assets/cloud/`;
- `//host` references;
- `javascript:` and `vbscript:` URLs;
- any network identifier (`fetch`, `XMLHttpRequest`, `WebSocket`,
  `EventSource`, `importScripts`, `sendBeacon`) outside `assets/cloud/`;
- any file type it does not know;
- an empty bundle.

What goes into `assets/cloud/` is decided by **contents**, not by name
(`apps/web/build/chunks.ts`):
- a code-splitting group gives `apps/web/src/cloud/**` its own chunk;
- that chunk is filed under `assets/cloud/` only if every module in it is
  cloud code or a permitted cloud dependency (contracts, provenance,
  valibot, or Rolldown's runtime helper).

A module elsewhere that happens to be called `cloud.ts` lands in `assets/`
and fails the scan. Vite's modulepreload polyfill is disabled because it
contains a `fetch` call.

### P0-13 rules (T-S40, SAFETY §8 item 31)

These apply to every text file, cloud chunks included:
- `testkit-marker`: the value of `TESTKIT_MARKER`
  (`packages/testkit/src/marker.ts`, read from there, never copied);
- `mock-serial-port`: the name `MockSerialPort`;
- `transport-query`: `transport=` as query text, or
  `.get('transport')`/`.has`/`.getAll` (there is no `?transport=` switch);
- `url-scheme`: any URL scheme other than `data:` and `blob:` that the rules
  above do not already report (`mailto:`, `tel:`, `about:`, `file:` ...), in
  JavaScript and JSON string literals, HTML/SVG URL attributes and meta
  refresh, and CSS `url()` and `@import`;
- `web-serial`: `navigator.serial` and the names `requestPort` and
  `getPorts`. Phase 0 cannot reach a port; P1-01 narrows this rule to the
  machine worker's chunk, in the same owner-approved PR that narrows the
  `run/no-web-serial` lint rule.

**Why the marker survives minification.** A minifier drops unused exports
and renames classes, so a marker export alone would vanish from a bundle
that still ships test-kit code. `marker.ts` therefore also names the marker
in a side effect (a read-only flag on `globalThis`); every module in
`packages/testkit/src/` loads it (enforced by `packages/testkit/test/marker.test.ts`);
and the package declares `"sideEffects": true`, so a bundler keeps that
statement whenever any test-kit module is bundled, even through a bare
import. `MockSerialPort` also reports its name through `Symbol.toStringTag`.

`tools/gates/test/bundle-acceptance.test.ts` proves it on real builds:
importing the test kit into an entry (bare, a used class, one deep module,
the marker itself) fails both dependency-cruiser (`entries-never-reach-testkit`)
and the scan; `transport=` handling, a `mailto:` URL and Web Serial each fail
the scan, and a `data:` URL passes.

The scan is a backstop on the built text: it cannot see a name assembled
at run time. The dependency-cruiser and ESLint rules on the source are the
primary gates.

## Artifact verification

Both `e2e` and the deploy jobs run `node tools/gates/src/repro/cli.ts verify`
on each extracted tar (`site` against `run-web.sha256`, `worker` against
`run-worker.sha256`). It fails on any changed, missing or added file. The
deploy jobs first verify the attestation of all four files with
`gh attestation verify`.

## Done in P0-04

- `workers/run/wrangler.jsonc` exists, and the deploy steps are complete
  (docs/ops/worker.md). Deploys stay off until the owner sets
  `RUN_DEPLOY_ENABLED`, and the preflight refuses them while the D34 account
  id is a placeholder.
- The Worker script is part of the attested artifact. The build job builds it
  twice and compares; the deploy jobs deploy it with `--no-bundle`, so they
  deploy only attested bytes.

## Done in P0-06

- The `e2e` job runs the Playwright suite against `wrangler dev` serving the
  artifact, under the origin guard, and the third-party canary (above).
- **Proof in CI** needs the GitHub repository: the first PR run shows the
  `e2e` job's suite passing (T-S25) and the canary line
  `canary: ok. The suite failed as it must, ...`. Save the run URL in the
  P0-06 PR.

## Not finished (by design)

- **The rest of the RUN_PLAN §6.2 pipeline** joins `verify` with the tasks
  that create it:
  - token drift (P0-05);
  - model-based and conformance tests (P0-11 onwards);
  - Stryker;
  - API integration tests.
