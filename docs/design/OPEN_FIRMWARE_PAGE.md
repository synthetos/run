# run: an open firmware update page (no sign-in)

Status: approved by the owner, 2026-11-14. Owner asked: "the /firmware link should be accessible by anyone, no need for a gh
login to allow for firmware; everything else needs a gh account".

## Why

- Updating TinyG today means a bootloader tool, a hex file and a command line. A browser update in one page helps every TinyG
  owner, including people who never cut with run.
- The blog can link straight to it ("update your TinyG in the browser").
- A firmware update never moves the machine: it identifies the board, backs up its settings, writes a signed release, waits for
  the firmware to start and restores the settings.

## Goals

- Anyone can update a TinyG to a release in run's signed firmware list, from a page linked from the blog, without an account.
- Every step of the existing flash gate (SAFETY §4.8, as built and as amended) stays exactly as it is.
- Everything else that touches a machine still needs a Synthetos sign-in (D1).

## Non-goals and anti-goals

- No jog, home, console, job, probe, spindle or coolant controls on the page, not even hidden. Their code is not in the page's bundle.
- No custom firmware upload on the open page (custom firmware and trusted images stay in the signed-in workspace).
- No account features: backups stay on this computer (plus a download). "Saved to your account" only in the workspace.
- Failure: a visitor reaching jog or a job through this page, or the page weakening the sign-in rule for the rest of run.

## The address

- **`run.synthetos.com/update/`** (my call). `/firmware/` already serves the firmware files themselves
  (`/firmware/<name>.hex`, workers/run/src/firmwareProxy.ts); a page under the same prefix would mix two kinds of routes.
  `/firmware` and `/firmware/` (exactly) redirect to `/update/`, so the blog can use either.

## How the sign-in rule stays intact

1. **A separate page, not the workspace.** A new page entry (`update/index.html`, registered in src/pages/registry.ts like
   safety/privacy/wiring). It loads its own small app: port choice, identity, idle check, the flash flow, restore, recovery.
2. **The server grants machine access to that page only.** `grantsSerial` gains one case: production, exact path `/update/`
   (and only HTML document responses), grants `serial=(self)` without a session. Every other path keeps today's rule. Moving
   from `/update/` to any other page is a full page load (run is a multi-page app), and that page gets `serial=()` again.
3. **The bundle proves it.** A build check walks the update page's chunk graph and fails if it contains the motion, job, console,
   probe or jog modules (or the motion command kind of the write gate). Same style as the existing bundle scans (T-S40).
4. **The machine worker runs in a firmware-only mode** on that page: the only command kinds it accepts are identity reads,
   polled reads, the settings backup read, the §4.8 flash sequence, the §4.6 restore writes and the recovery actions. Anything
   else is refused in the worker, not just hidden in the UI.

Honest limit: this is a product rule, not a wall against the machine's owner. Someone with the browser's developer tools open
on `/update/` can do what any desktop sender can already do. What the design guarantees is that run itself never offers
motion without sign-in, and that no other run page gains machine access.

## What the page does (unchanged flash gate)

Connect (port chooser) → identity (classified TinyG; an unclassified board only through recovery) → idle gate → the C6
checklist, including the mains-isolation box → settings backup stored on this computer (and offered as a download) →
`{"boot":1}` → bootloader checks → raw EEPROM and application reads stored → write, read back, CRC, `E` → wait for the
firmware banner → version check → required restore from this run's pre-flash snapshot (§4.6, cross-build mapper) → mains
confirmation → switch check → "Done. Your TinyG runs <build>." with a link to the workspace and the blog post.

- Offers only releases in the signed list compiled into run (`firmware/releases.json`), served same-origin under `/firmware/`.
- `flashRestorePending` and the bootloader quarantine work the same, in this browser's `device-safety`, so an interrupted
  update finishes on the next visit to `/update/` (or in the workspace).
- A short first screen says what will happen, what to have ready (USB cable, E-stop within reach, spindle mains off) and
  that no account is needed.

## Safety rule change (SAFETY.md, for owner approval)

> *Amended 2026-11-14 (owner): open firmware update page.* The firmware update at `/update/` is available without sign-in, as
> the single exception to D1. On that page only: Connect in firmware role, the §4.8 flash sequence, the §4.6 restore it requires,
> and recovery. The page is a separate entry whose bundle contains no motion, job, console, probe or jog code (build check), its
> machine worker refuses every other command kind, and the server grants `serial=(self)` to that exact page and no other
> unauthenticated document. Custom firmware stays in the signed-in workspace. Every step of §4.8 applies unchanged.
> The identity-service outage row of §4.9 gains: the update page keeps working without the identity service.

## Order of work

1. Owner approves this and the safety text.
2. Codex builds it on staging (page entry, worker mode, header rule, bundle check, tests). I review, run all gates and walk
   the page with screenshots.
3. Bench run on staging with the TG-Firmware session's go-ahead (a real flash to a test board; bench 1 stays off-limits).
4. Production: ships with the next production deploy. The blog link goes live when 450.05 is in run's signed list.

## Left to the builder

The page's layout and wording (short sentences, existing tokens, zebra rows for the checklist), module boundaries, and how the
firmware-only worker mode is selected (a build-time constant per entry is preferred over a runtime flag).
