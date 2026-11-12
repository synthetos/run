# Releases

Each entry says what ships and, just as important, what does not. A release
is a tag `run-v<major>.<minor>.<patch>` on the `main` commit whose attested
artifact CI deployed to production. The tag never triggers a build or a
deploy; it records one.

## Staging go-live: sign-in with Synthetos accounts (2026-11-12)

Not a tagged release: it records the staging go-live of docs/ops/go-live-staging.md §6.

- run-staging deployed with sign-in on: 2026-11-11, `deploy-staging` in
  https://github.com/synthetos/run/actions/runs/43056342063 (commit 82d485c). Current staging build: 7dcbf26,
  https://github.com/synthetos/run/actions/runs/43293414065 (it also created the A2-01 staging data resources).
- accounts-staging deployed: 2026-11-11, https://github.com/synthetos/accounts/actions/runs/43122481858.
- §5.3 "Check the whole sign-in" passed on staging (owner, 2026-11-12).
- Production deploys with sign-in off (bindings absent) until §7 is done: run 43293414065 `deploy-production`,
  2026-11-12, smoke test passed.

## run-v0.1.0: Phase 0 foundations (pending)

**Status: not tagged yet.** The tag waits for the first production deploy,
which needs the owner's actions in the ops pages under `docs/ops/` (GitHub repository,
the Cloudflare account locked down per D39, Access on staging, DNS). When the deploy has
succeeded, fill in the three lines below and tag that commit.

- Commit: _(the `main` commit deployed to production)_
- Production deploy run: _(URL of the `ci.yml` push run, `deploy-production` job)_
- Smoke test output: _(paste the output of the "Post-deploy smoke test" step of
  `deploy-staging` and `deploy-production`)_

### What ships

- The workspace shell at `run.synthetos.com`: the safety bar with W1 (the
  hardwired E-stop warning), `NOT CONNECTED`, the version chip and the
  disabled stop and pause controls, which work without JavaScript too.
- `/safety/`: the safety page. `/privacy/`: the placeholder privacy notice.
  A static 404 page. The web app manifest and icons (installable).
- `/api/health` on the `run` Worker. Every other `/api/*` and `/auth/*` path
  is a 404.
- The security headers of RUN_PLAN §6.4 (CSP with Trusted Types,
  Permissions-Policy allowing only `serial` and `screen-wake-lock` for the
  page, COOP, CORP and the rest) on
  every response, from one module.
- `staging.run.synthetos.com`, reachable only through Cloudflare Access (D31).
- In the repository, not on the site: the protocol, safety, schema, machine
  and testkit packages with their tests, the CI gates (lint, boundaries,
  licences, bundle scan, reproducible and attested artifact, deploy gate),
  the vendored HIL tables (`den.json`, `d440.json`, `d449.json`) and the
  Phase 0 safety traceability (`docs/safety/PHASE0_TRACEABILITY.md`).

### What does not ship

- **No serial.** Nothing in this release can open a serial port. Web Serial
  is banned by lint and by the bundle scan until P1-01, and the deployed
  bundle contains no reference to it.
- **No accounts and no sign-in.** Under D1, connecting a machine and starting
  a job will require a signed-in Synthetos account. That gate arrives in
  Phase 1, at connect and Start only; nothing in the machine path will ever
  consult the session.
- No cloud storage, no G-code preview, no configuration, wiring or flashing.
- No approved firmware builds for production. The `release` channel of
  `firmware/approved-builds.json` is empty, and the only release key is a
  staging-only placeholder (`docs/ops/release-key.md`).
