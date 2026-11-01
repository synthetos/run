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
> hardware. Read the safety contract before connecting a machine (it will be
> published at `/safety/` and copied into this repository as `SAFETY.md`).

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

## Dependency rules

- `protocol`, `safety`, `machine`, `schema`, `flasher` and `provenance` have
  **no runtime npm dependencies** and never import network APIs, `contracts`
  or the cloud client.
- The cloud client (`apps/web/src/cloud`) never imports `machine`,
  `protocol` or `safety`, and they never import it.
- `workers/run` imports only `contracts`. The server holds no machine logic.
- No production entry may import `testkit`.
- Panels act only through typed intents checked by `safety.allowed`; no code
  outside `MachineSession` writes to the port, and nothing is loaded at
  runtime.

These rules will be enforced in CI by dependency-cruiser, ESLint and a
bundle scan (P0-02, P0-03, P0-13). Until those gates land they are
checked by review; the smoke tests already fail if a safety-path package
declares a runtime dependency.

## Development

Requirements: Node.js 22.12 or later, and pnpm via Corepack (the exact
version is pinned in `package.json` `packageManager`).

```sh
corepack enable            # or prefix commands with `corepack`
pnpm install --frozen-lockfile --ignore-scripts
pnpm -r typecheck
pnpm lint
pnpm -r test
pnpm --filter web build
```

`pnpm check` runs typecheck, lint, tests and the build in that order.

Dependency hygiene: versions are pinned exactly (`save-exact`), install
scripts never run (`ignore-scripts`), and pnpm refuses versions published
less than seven days ago (`minimumReleaseAge`).

## Licence

Apache License 2.0. See `LICENSE` and `NOTICE`. Controller firmware (TinyG,
g2core) is GPL-2.0 and lives in its own repositories.
