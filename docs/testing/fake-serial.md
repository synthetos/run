# Fake serial in `machine.worker` under Playwright

ROADMAP P0-14, RUN_PLAN §8.5. Spike run on 2026-11-01. Last checked with
`@playwright/test` 1.64.0 and its Chromium build 1248 (Chrome for Testing
156.0.8078.4, headless), on macOS.

## The question

RUN_PLAN §8.5 wants the end-to-end suite to inject a fake `navigator.serial`,
backed by the test kit, through a Playwright init script, so that the real
transport code runs in the real built app. Serial is used only in
`machine.worker`, a dedicated worker (RUN_PLAN §5.4). Can a Playwright init
script define `navigator.serial` inside a dedicated worker?

## Answer: no

A Playwright init script never runs in a dedicated worker. The fallback the
ROADMAP describes is therefore implemented: a test-only build swaps one
module, and CI proves the test artifact differs from the production artifact
in that module's chunk and nowhere else.

## What was tried

Each attempt used a page that starts a module worker which immediately
reports `typeof self.__INJECTED` (a marker the injected code sets) and
`typeof navigator.serial` back to the page.

| Attempt | Result |
|---|---|
| `page.addInitScript(...)` | Runs in the page (the page sees the marker). **Does not run in the worker** (marker `undefined`). |
| `browserContext.addInitScript(...)` | The same: page yes, worker no. |
| `page.on('worker', w => w.evaluate(...))` | Too late. The worker's top-level code has already run by the time the event fires, so the worker reported no marker. Even when it wins, it only patches the worker after startup, which is a race, not an injection. |
| CDP: `Target.setAutoAttach({ waitForDebuggerOnStart: true, flatten: false })` on a `newCDPSession`, then `Runtime.evaluate` and `Runtime.runIfWaitingForDebugger` sent through `Target.sendMessageToTarget` | **Works**: the worker is paused before its first statement, the code runs, the worker then saw the marker. **Not adopted** (see below). With `flatten: true` the worker paused and could not be resumed, because Playwright's `CDPSession` cannot address a flattened child session, and the page hung. |

Two further observations:

- Headless Chromium already exposes the real `navigator.serial` in dedicated
  workers (`typeof` is `object`). A fake would have to replace a real API,
  not fill a gap.
- In the CDP attempt the reply to `runIfWaitingForDebugger` arrived before
  the reply to `Runtime.evaluate`. The ordering held in this run, but a
  harness built on it would have to await each reply by id before resuming
  the worker.

### Why the CDP route was not adopted

- It is not an init script. It uses `Target.sendMessageToTarget`, which is
  deprecated in the DevTools protocol, and the non-flattened session mode.
  Playwright keeps its own auto-attach session open on the same page, so a
  second one is an unsupported combination that could break on any
  Playwright or Chromium update.
- It is Chromium-only. The fallback works with any browser Playwright drives.
- It patches a live production bundle from outside, which is harder to
  audit than a build in which one module is visibly replaced and every other
  byte is shown to be identical.

The production suite keeps the main finding as a regression test:
`tools/e2e/specs/machine-worker.e2e.ts`, "spike finding: an init script
reaches the page but not the dedicated machine worker". If a Playwright
upgrade ever makes init scripts reach workers, that test fails, and this
decision should be revisited.

## The fallback, as built

### The seam

`apps/web/src/machine-worker/transport.ts` is the transport seam of
`machine.worker`. It exports only `createTransportSource()`, which returns a
`TransportSource` (`packages/machine/src/transport.ts`): a `kind` and a
`request()` that yields a new, unopened `Transport` or `null`.

- **Production, Phase 0:** `kind: 'none'`, and `request()` always resolves
  `null`. The worker answers every `open` with `unavailable`. Nothing in
  Phase 0 can reach a serial port, and the bundle scan still finds no Web
  Serial name in the build.
- **Release build, P1-01 (done):** this module returns
  `webSerialTransportSource()` (`packages/machine/src/webSerialTransport.ts`):
  `request(selector)` takes the granted port at the selector's grant index
  from `navigator.serial.getPorts()`, only if its USB identity matches, and
  hands the worker a new `WebSerialTransport` over it; otherwise null.
  Under the production headers (`serial=()`) the browser refuses
  `getPorts()`, so `open` is `unavailable` there; the staging and bench
  suites show the worker asking for the granted ports and finding none.
- **Fake-serial test build:** the whole module is replaced by
  `tools/e2e/fake-serial/transport.ts`.

The worker itself (`machine.worker.ts`, `host.ts`, `rpc.ts`) is the same in
both builds. It opens whatever the source gives it only through
`GuardedTransport`, with 115200 baud, `flowControl: 'none'` and
`bufferSize: 256`, counts the bytes it reads, and writes nothing. It holds no
session or account state: under D1 the sign-in gate belongs to the
main-thread UI, and nothing in the machine path consults the session.

### The test build

`pnpm build:fake-serial` runs `vite build --mode fake-serial`
(`apps/web/build/fakeSerial.ts`):

- The output goes to `apps/web/dist-fake-serial/`, never `dist/`. Any build
  mode other than `production` and `fake-serial` is refused.
- A plugin in the worker build redirects every import that **resolves to**
  the seam to `tools/e2e/fake-serial/transport.ts`. Matching on the resolved
  path, not the import text, catches every spelling of the import.
- If no worker build swapped the seam (for example after a rename), the
  build fails rather than produce a "test" artifact that runs production
  code.
- In **both** builds, the seam module, or its replacement together with
  everything only it imports, is placed in a chunk of its own:
  `assets/machine-transport-<hash>.js`. The swap can therefore change that
  chunk and nothing else.

The replacement hands the worker a `MockTransport`
(`tools/e2e/fake-serial/mockTransport.ts`) over the test kit's
`MockSerialPort`. Behind that port is a `SimEndpoint` and a
`TinyGEdgeNextModel` that boots and prints its banners, on a real-time
clock. Each port is listed on `globalThis.__RUN_FAKE_SERIAL__` inside the
worker, so a test can inspect what the worker did to it (`openLog`, for
example).

### The diff check

`pnpm fake-serial:diff` runs `tools/gates/src/artifact/diff-cli.ts`, which
takes a production site tree and a test site tree and prints a hash list of
every file:

- Every file gets a logical name: Vite's 8-character content hash is
  dropped from names under `assets/`.
- Text files are hashed after every hashed file name in the tree has been
  replaced by its logical name. The worker chunk, which imports
  `./machine-transport-<hash>.js`, therefore hashes the same in both trees
  if nothing else in it changed.
- The check fails if:
  - the trees do not have the same files;
  - any file other than `assets/machine-transport.js` differs;
  - the seam chunk is missing, or identical in both trees (nothing was
    swapped);
  - the production tree contains the test kit marker;
  - the test seam chunk does not contain the marker.

  That last rule guarantees the bundle scan refuses the test build, so it
  can never pass for a production artifact.

On the current tree, all 26 files are `same` except
`assets/machine-transport.js`. That chunk is 98 bytes in production and
about 127 kB in the test build.

### CI

The `e2e-fake-serial` job in `.github/workflows/ci.yml` runs on every PR and
push and needs `build`. The deploy jobs need it.

1. It builds the fake-serial test artifact from the checkout. This happens
   before anything else is added to the checkout, so the build info names the
   clean commit, as it does in the attested artifact.
2. It downloads `run-web` and verifies the production site against its
   manifest.
3. It runs the diff check: **attested production artifact vs. this test
   artifact**.
4. It runs the fake-serial Playwright suite against `wrangler dev` serving
   the test artifact. It uses the same Worker, headers, CSP, Trusted Types
   and origin guard as the main suite.

It uploads nothing, and the policy gate (`fake-serial-job` in
`tools/gates/src/workflow/policy.ts`) refuses an upload step, a build after
the download, a changed step order, or any use of `RUN_E2E_SITE` /
`RUN_E2E_WORKER` in that job.

### The example test

`tools/e2e/specs/open-mock-port.fake-serial.ts` (ROADMAP acceptance) passes.
The page never exposes its `Worker` object, and the app has no test hook. The
test therefore evaluates code **inside** the worker (`Worker.evaluate`). That
code dispatches an ordinary request `message` event on the worker's global
scope, with a fresh `MessageChannel` port to answer on. The worker's own
listener handles it exactly as it would a message from the page. The worker
does not check `isTrusted`, because only code already running in the worker
can dispatch such an event.

The test asserts (RPC version 3, P1-02) that:
- the worker reports `source: 'fake'`;
- `open` succeeds and reports the board's USB identity (0403:6015);
- the mock port's `openLog` shows one open with
  `{ baudRate: 115200, flowControl: 'none', bufferSize: 256 }`;
- the read-only `MachineSession` waits out the simulated board's boot,
  probes it from `{sr:null}`, classifies it `tinyg-en` (READ_ONLY: the
  worker has no approved builds yet) and reaches CONNECTED_UNKNOWN;
- Pause writes `!`, an allowlisted read is answered, `md` is refused, and
  every byte written to the board is a single-token GET or `!` (read from
  the simulated link's transcript);
- a second `open` is denied by the allow-matrix and opens nothing;
- `close` releases the reader and closes the port;
- a subscribed port receives the session snapshots, at most 20 per second;
- the page itself still shows NOT CONNECTED.

The production suite (`machine-worker.e2e.ts`) asserts, on the attested
artifact, that:
- the page starts exactly one `machine` worker from a hashed `/assets/`
  chunk, through the `rs-worker` policy, with no CSP violation;
- `open` is refused with `unavailable`.

Run it locally with `pnpm e2e:fake-serial` (production build, test build,
diff, suite).

## Limits

- The fake-serial suite tests the test artifact, not the attested one. The
  diff check is what carries its results over to production, and it is only
  as strong as "every other file is byte-identical". That holds today.
- The production seam module itself never runs in the fake-serial suite. The
  production suite covers it (`open` is `unavailable`), and so do the unit
  tests in `apps/web/test/machineWorker.test.ts`.
- `MockTransport` is test code. It is a thin `SerialPort`-to-`Transport`
  adapter with no checks of its own; the guard it is wrapped in is the
  production `GuardedTransport`.

## Recommendation for P1-01 (a deviation to decide; still open)

P1-01 kept the seam where it is, above `WebSerialTransport`: the P1-00
gates (the fake-serial diff's `test-web-serial` rule, the serial chunk
filed by content) were built for exactly that, and moving the seam is the
owner's call. `WebSerialTransport` is instead exercised in the machine
package's unit tests against the test kit's `MockSerialPort` with both
firmware models, and against EN-HIL replays
(`packages/machine/test/web-serial-*.test.ts`). The recommendation below
stands for the owner to decide.

The ROADMAP wording is "swap `WebSerialTransport` for `MockTransport`".
`WebSerialTransport` does not exist in Phase 0, so the seam here is the
module that will construct it. If P1-01 keeps the seam above
`WebSerialTransport`, the real `WebSerialTransport`, which handles reader
locks, write ordering and close-while-writing, never runs end to end. That
is the very code RUN_PLAN §8.5 wanted exercised.

Recommended for P1-01:
- Move the seam **below** `WebSerialTransport`, to where the `SerialPort`
  comes from.
- **`requestPort()` stays on the main thread.** It exists only on Window
  (it needs a user gesture and shows the browser's chooser), never in a
  dedicated worker. RUN_PLAN §5.4: "the window calls requestPort() with
  filters. The worker opens the port". So the window calls `requestPort()`,
  reads the chosen port's `getInfo()` and its index in its own
  `getPorts()`, and sends `open` with that `PortSelector`
  (`{usbVendorId, usbProductId, grantIndex}`, rpc.ts v2, P0 review).
- `packages/machine/src/webSerialTransport.ts` exports `WebSerialTransport`
  (constructed with a `SerialPort`) and a `findGrantedPort(selector)` that
  runs **inside machine.worker**: it calls `navigator.serial.getPorts()`,
  takes the port at `grantIndex`, and returns it only if its `getInfo()`
  matches the selector's USB identity; otherwise null (refuse, never guess:
  with two granted boards, "the first matching" port could be the wrong
  machine). That keeps the only `navigator.serial` use in the one file
  P1-01's lint rule allows (plus the window's `requestPort()` call, which
  P1-01 must allow in exactly one main-thread file).
- The production seam's `request(selector)` calls both. The fake seam
  constructs the **real** `WebSerialTransport` around a test-kit
  `MockSerialPort` it picks by the same selector rule, and `MockTransport`
  is deleted.

The build plugin, the separate chunk, the diff check and the CI job stay as
they are. The seam bodies change, and so does the window: it gains the
`requestPort()` call that produces the selector (the `TransportSource`
interface and the `open` request already carry it, so neither changes
again). This needs the owner's decision because it changes the ROADMAP's
wording.
