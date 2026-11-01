# Bench guide: the localhost bench build

P1-00 (owner decision D41, proposed: `docs/ops/owner-decisions.md` OD-3).
This page grows with Phase 1: each task adds what it needs checked on the
real bench. The HIL checklist proper (HIL-1.x, `SAFETY.md` §9) and the
bench runner come with P1-08.

## What the bench build is

- The release web app with one module swapped: the build-channel seam
  (`apps/web/src/channel/channel.ts` becomes `bench.ts`). `pnpm bench:check`
  proves that nothing else differs, so what you see is the release code.
- It runs only on `http://localhost` (or `127.0.0.1`), served by the
  loopback bench server, which sends the production headers with
  `Permissions-Policy: serial=(self)`. The page shows "bench build,
  localhost only" on the version chip and `[bench]` in the tab title.
- It is never deployed. CI never builds it; every staging and production
  scan refuses its marker; ci-policy refuses any workflow line that
  mentions it.

## Running it

From the repository root (Node 22, pnpm through Corepack):

```sh
corepack pnpm build          # the release build, apps/web/dist
corepack pnpm build:bench    # the bench build, apps/web/dist-bench
corepack pnpm bench:check    # bench scan + "only the build-channel chunk differs"
corepack pnpm bench:serve    # http://localhost:8793/ (127.0.0.1 only)
```

Open http://localhost:8793/ in Chrome or Edge. Stop the server with Ctrl-C.
`--port <n>` picks another port. The server refuses to start on anything
but a clean bench build, and answers only `localhost:<port>` and
`127.0.0.1:<port>` as Host.

`corepack pnpm e2e:bench` runs the bench Playwright suite (local only): the
page loads and marks itself, every response carries the serial-granted
headers, and the browser allows Web Serial in the page and in
`machine.worker` (and nothing else).

Use one Chrome profile for the bench. The Web Serial grant is per origin
(`http://localhost:8793` is its own origin, separate from staging).

## Bench checks for P1-00 (owner, on the bench computer)

Each needs the physical bench and cannot be signed by the implementer.

| ID | Check | When |
|---|---|---|
| BENCH-P100-1 | With `pnpm bench:serve` running, open http://localhost:8793/ in the bench Chrome profile: the version chip ends in "bench build, localhost only", the title starts with `[bench]`, and DevTools shows `Permissions-Policy: serial=(self), ...` on the document. | now |
| BENCH-P100-2 | Open http://<this computer's LAN address>:8793/ from another device: no answer (the server listens on 127.0.0.1 only). | now |
| BENCH-P100-3 | With a TinyG plugged in, after P1-01: the port picker opens from the bench origin, and from staging (behind Access); a production tab (https://run.synthetos.com) cannot open it (`serial=()`). | after P1-01 |
| BENCH-P100-5 | Read-only session with an axis in inhibited mode (`am=2`) away from 0, or of unknown mode: the axis-mode facts are shown, not hidden (`axisModeFacts`, row 35). | after P1-07 renders them |
| BENCH-P100-4 | After the first staging deploy: the staging document carries `serial=(self)`, and `run.synthetos.com` still `serial=()` (docs/LEAD_ACTIONS.md, "Phase 1, from P1-00"). | after the staging deploy |

The SAFETY §9 HIL-1.x items and the bench tasks B-ID-1, B-SIG-1, T2.1,
B-POL-1, B-PROBE-1, B-MD-1, B-EXCL-1 and B-SPLICE-1 are the Phase 1 exit
(ROADMAP "Phase 1: Bench read-only"); a signed HIL record is always taken
on the staging artifact (SAFETY HIL-6.4), never on the bench build.
