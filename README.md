# run.synthetos.com

The browser workspace for Synthetos CNC controllers: configure the board,
draw and check wiring, flash vetted firmware, and send G-code to run real
jobs, from desktop Chrome or Edge over Web Serial, tied to a Synthetos
account.

> **Status: Phase 0 (foundations).** Nothing in this repository can open a
> serial port or move a machine. Packages are empty scaffolds that later
> tasks fill in.

> **This software is not an emergency stop.** Any machine it drives must have
> a hardwired, latching E-stop that removes motor and spindle power in
> hardware. Read the safety contract before connecting a machine: it is
> `SAFETY.md` in this repository, and will be published at `/safety/`.

## Layout

| Path | Role |
|---|---|
| `packages/protocol` | Framing, inbound classification, dialect data, capability probe and classifier, read allowlists |
| `packages/safety` | Allow-matrix, sanitiser, preflight, jog plan, flash gate, fault policy, overrun bound, warning strings |
| `packages/machine` | Transport interface, `MachineSession` (the single writer), flow engines, streamer, watchdog, stop sequences |
| `packages/schema` | Units, generated settings schemas, MachineProfile v2, fact engine |
| `packages/gcode` | G-code parser and dialect-aware interpreter and analyser |
| `packages/flasher` | Firmware manifest, HEX validation, xboot client |
| `packages/wiring` | Board data, components, rules engine, renderers |
| `packages/provenance` | Device-local trust anchor and authorship decisions (pure) |
| `packages/contracts` | API types and valibot schemas shared by the web app and the Worker |
| `packages/testkit` | **Dev only.** Firmware models and fakes for tests; never in a production bundle |
| `apps/web` | The workspace UI (Preact, Vite multi-page app) |
| `apps/cli` | Bench tooling (Node) |
| `workers/run` | The Cloudflare Worker serving the app, `/api/*` and `/auth/*` |
| `tools/gates` | **Dev only.** The repository's lint rules, the licence gate and the gate acceptance tests |

## Dependency rules

- `protocol`, `safety`, `machine`, `schema`, `flasher` and `provenance` have
  **no runtime npm dependencies** and never import network APIs, `contracts`
  or the cloud client.
- The cloud client (`apps/web/src/cloud`) imports only `contracts` and
  `provenance`, so never `machine`, `protocol` or `safety`, and the safety
  path never imports it.
- `workers/run` imports only `contracts`. The server holds no machine logic.
- No production entry may import `testkit`.
- Panels act only through typed intents checked by `safety.allowed`; no code
  outside `MachineSession` writes to the port, and nothing is loaded at
  runtime.

These rules are enforced by the gates below (P0-02, P0-03). Test-kit
markers are added to the bundle scan in P0-13.

| Gate | Command | What it enforces |
|---|---|---|
| Boundaries | `pnpm deps` | `.dependency-cruiser.cjs`: no npm (direct or transitive) and no Node built-ins in the safety path; no `contracts` or cloud client in the safety path; the cloud client imports only `contracts` and `provenance`; `workers/run` imports only `contracts`; no entry reaches `testkit`; nothing imports from outside the repository; every import resolves |
| Lint | `pnpm lint` | `eslint.config.js` with the repository's own rules in `tools/gates/src/eslint/`: no `eval`/`new Function`; no HTML sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `dangerouslySetInnerHTML`) outside `apps/web/src/security/tt.ts`; no `abort` in `machine`; no `Math.random` in `safety` and `protocol`; no network identifiers in `protocol`, `safety`, `machine`, `flasher` and `provenance`; no `navigator.serial`, `requestPort` or `getPorts` anywhere (until P1-01); no `WARNING —`, `DANGER —` or `NOTICE —` strings outside `packages/safety/src/strings.ts`. Inline `eslint-disable` comments are ignored (`noInlineConfig`), so a rule can be relaxed only in `eslint.config.js` |
| Licences | `pnpm licence` | Production dependencies: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or OFL-1.1. Dev dependencies may also be MPL-2.0, or carry a reviewed exception in `tools/gates/src/licence/exceptions.ts`. GPL and AGPL are never allowed |
| CI policy | `pnpm ci-policy` | Workflows: only the deploy jobs touch secrets or the Cloudflare token; deploy jobs run only on a push to `main` behind protected environments; actions pinned by SHA; no `pull_request_target`; no `${{ }}` in scripts. CODEOWNERS covers every SAFETY §8 path. The PR template carries the SAFETY §8 checklist verbatim |
| Bundle scan | `pnpm scan` (after a build) | No origin literal, `//host`, `javascript:` URL or network identifier in `apps/web/dist` outside the cloud-client chunks (`assets/cloud/`, decided by content in `apps/web/build/chunks.ts`) |
| Reproducible build | `pnpm repro` | Clones `HEAD` twice, installs only the build toolchain, builds both and fails unless they are byte-identical, then scans |

`pnpm gates` runs lint, boundaries, licences and the CI policy. `tools/gates/test/acceptance.test.ts` proves
each gate fails on a violation: it copies the working tree, introduces one
violation, runs the real gate command and checks which rule caught it.

A change to `.dependency-cruiser.cjs`, `eslint.config.js`, `tools/gates/`,
`.github/` or `apps/web/build/` changes the safety boundary and needs
safety-path review (`.github/CODEOWNERS`).

## CI and deploys

`.github/workflows/ci.yml` runs these jobs:
- `verify`, secret-free;
- `build`, secret-free: the minimal build toolchain, two clean builds that
  must match byte for byte, and the bundle scan;
- `e2e`;
- `attest`, which signs build provenance;
- `deploy-staging` and `deploy-production`, which run on `main` only, behind
  protected environments, and deploy only the attested artifact.

Pull requests that touch safety paths must carry the SAFETY §8 checklist and
two approvals (`safety-review`).

See `docs/ops/ci.md` for how it works, and `docs/ops/branch-protection.md`
for the GitHub settings the owner must enable. `SAFETY.md` is the in-repo
copy of the safety case.

## Development

Requirements: Node.js 22.18 or later (it runs the TypeScript gate and
bench scripts directly, with type stripping), and pnpm via Corepack (the exact
version is pinned in `package.json` `packageManager`).

```sh
corepack enable            # or prefix commands with `corepack`
pnpm install --frozen-lockfile --ignore-scripts
pnpm -r typecheck
pnpm gates                 # lint, dependency-cruiser, licences
pnpm -r test
pnpm --filter web build
```

`pnpm check` runs typecheck, the gates, tests, the build and the bundle scan
in that order.
Its nested `pnpm` calls need pnpm on `PATH` (`corepack enable`).

Dependency hygiene: versions are pinned exactly (`save-exact`), install
scripts never run (`ignore-scripts`), and pnpm refuses versions published
less than seven days ago (`minimumReleaseAge`).

## Licence

Apache License 2.0. See `LICENSE` and `NOTICE`. Controller firmware (TinyG,
g2core) is GPL-2.0 and lives in its own repositories.
