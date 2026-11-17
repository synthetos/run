# First run: the Run logo, the sign-in front door, and the setup wizard

Design, 2026-11-16, **approved by the owner 2026-11-17** (builder: the lead session; Codex on hold). Owner decisions are marked **(owner)**; calls made while writing are marked **(call)** and may be
overturned by the owner. What is left to the builder is listed at the end. The learning system (tutorials, help pages,
"Show me" spotlights) is **out of scope** here: the owner held it on 2026-11-16 as its own later project.

Mockups the owner reacted to (the source of truth for look and feel), all in
`/Volumes/External/projects/TinyG-work/handoffs/run-ui/`:

| File | What |
|---|---|
| `2026-11-16-signin-gate-{dark,light}.html` / `.png` | The dimmed workspace with the sign-in dialog (before the logo swap) |
| `2026-11-16-run-marks4-{dark,light}.html` | Logo round four; option **C** is the pick |
| `2026-11-16-wizard-{dark,light}.html` / `.png` | The six wizard steps at real size, and a tutorial sample that is now out of scope |

## 1. Intent

Run becomes a signed-in product. A visitor without a Synthetos account sees the workspace but cannot use it; one
GitHub click signs them in (and creates the account on first use, through accounts.synthetos.com, the single sign-in).
A signed-in account with nothing set up is walked through machine, homing, tools and stock, and a first project, in a
short wizard that can be skipped and resumed. Run gets a mark of its own so the name is said once, and synthetos.com
points at Run with it.

**Why now (owner):** the end-to-end account work is merged (storage, sync, projects, files backup). The staging menu
showed "Not signed in" and the owner found the signed-out experience confusing and the "Synthetos Run / Sign in to use
Run" stack ugly. A new user today has no path from an empty account to a job on screen.

## 2. Goals, non-goals, anti-goals

**Goals**

- A signed-out visitor understands in one glance what Run is, that it needs a sign-in, and that the sign-in is GitHub.
- A signed-in account with no machine reaches the Job page with a project, a tool, a stock, current firmware and a
  homed machine in about five minutes, every step skippable.
- One logo family used everywhere Run is named: top bar, dialog, tab icon, README, synthetos.com.
- The Job page loses the pieces the owner called confusing or noise (section 7).

**Non-goals**

- Tutorials, help pages, action links, spotlights: held (owner, 2026-11-16).
- Changing who may sign in on production: production keeps `signIn: false` until the go-live sitting.
- Any firmware or homing behaviour change: the wizard calls flows that exist; the TG Firmware session owns firmware.
- A demo mode that drives a pretend machine for visitors (owner chose "look only").

**Anti-goals (a build that does these has failed even if it works)**

- Reassurance or safety filler anywhere in the new UI ("Stop controls never need an account", "Keep your E-stop within
  reach", "Saved in this browser" footers). The warning bar and `/safety` say it once. **(owner)**
- Short numeric inputs stretched to full width; radio options edge to edge; a dialog whose frame changes size between
  steps. **(owner)**
- Anything derived from the Synthetos crosshair as the Run mark. **(owner)**
- A second sign-in path. Sign-in is `/auth/login` → accounts.synthetos.com → GitHub, nothing else.
- Sign-in state that gates Pause, Stop job, spindle off or recovery (D1 stands).

## 3. Constraints the builder inherits

- Run's repo rules: files ≤ 400 lines, functions ≤ 80, complexity ≤ 15, ≤ 4 params; the modularity baseline
  (`tools/gates/modularity-baseline.json`) may only shrink; 100 % coverage on touched files; lint and typecheck clean.
- The lead gates every merge with all four suites (`pnpm check`, `e2e:fake-serial`, `e2e`, `e2e:staging`); agents run
  targeted tests only.
- UI changes ship with a first-time-user walkthrough: screenshots light and dark at 1280 and 320 px under
  `docs/design/screenshots/<slice>/`, produced by the existing `RUN_SCREENSHOTS=1 pnpm e2e` route.
- CSP has `form-action 'none'`: sign-in stays a plain link; sign-out stays the same-origin fetch.
- Theme tokens are copied from synthetos.com (`docs/design/tokens.md`); new colours are not invented. Run blue is
  `--blue`; text uses `--ink`/`--muted`; surfaces `--sheet`/`--paper`; rules `--rule`.
- Zebra rows on table-like lists; short sentences in all copy; sentence case; no all-caps labels.
- Commits carry no AI attribution. One commit per concern; "no behaviour change" commits never mix with behaviour.

## 4. The logo **(owner: round four, option C)**

A monoline lowercase **run**. Geometry, in the units of the mockup generator (x-height 24, baseline y = 40, stroke 3.4,
round caps and joins):

- `r`: stem `M4 40V16`, shoulder `M4 25a9 9 0 0 1 9-9`.
- `u`: `M20 16v16a8 8 0 0 0 16 0V16M36 16v24`.
- `n`, **the arc move**: left stem `M44 40V16` drawn as a dashed rapid (`stroke-dasharray 0.01 7.14`, round caps, so it
  reads as dots); arch and right stem `M44 24a8 8 0 0 1 16 0v16` in `--blue`; the tool, a filled `--blue` circle
  r 3.4 at (60, 40).
- Ink parts use `currentColor`, so the wordmark follows the theme; the blue parts use `var(--blue)` in CSS contexts and
  the literal theme value in standalone files (favicon, README), one file per theme where a file cannot read CSS.

Assets to produce, all SVG, in `apps/web/src/brand/` (new) with generated raster under `apps/web/public/icons/` via the
existing `pnpm gen:icons`:

| Asset | Content | Used by |
|---|---|---|
| `run-wordmark.svg` | the three letters | dialog head, README, synthetos.com |
| `run-mark.svg` | the `n` alone (viewBox around 40..64 × 12..44) | tab icon, menu, PWA icons, blog byline |
| lockup (a component, not a file) | Synthetos crosshair (as today, blue) + "Synthetos" in the condensed face + the wordmark at cap height | top bar |
| `icon-*.png`, maskable, monochrome | regenerated by `pnpm gen:icons`, whose `draw.ts` draws procedurally (no SVG rasterizer): the `n` is drawn there in code from the same geometry, with a unit test that the SVG and the drawn path share the numbers | manifest |

Placement **(owner)**: the top bar shows crosshair + "Synthetos" + wordmark (the wordmark replaces today's grey
"Run" text and hides at the same breakpoint it does now); the sign-in dialog shows the wordmark **alone**; the tab icon is
the `n`. The accounts site and the forum keep their own marks.

## 5. The front door **(owner: "visible but locked")**

### 5.1 Who sees what

The page reads `/api/session` as it does today (`live/account.ts`). Three states:

| State | What the visitor sees |
|---|---|
| `signed-in` | Run, as today, plus the wizard when section 6 says so |
| `signed-out` and `signIn: true` (staging, and production after go-live) | the workspace rendered as normal, dimmed under a scrim, with the **sign-in dialog** on top |
| `signed-out` and `signIn: false` (production today) | the same dimmed workspace and dialog, with the button replaced by one line, "Sign-in opens on this site soon", and the overview link kept **(call)** |
| `checking` / `unavailable` on a **hosted build** | the scrim without the dialog for `checking` (no flash of either state); for `unavailable` the dialog with the button and a second line, "The account service did not answer. Try again in a minute." **(call)** |
| any state on a **non-hosted build** (bench channel, localhost dev, previews, the e2e builds) | no lock at all, exactly today's page **(call, builder check Q1)** |

**Where the lock applies (call, revised while planning).** The page already keys its signed-out card on the session
read (`FirstVisitCard.ts`: it shows when `/api/session` says `signIn: true` and nobody is signed in, whatever the
origin), and the browser tests exercise it by stubbing that endpoint on 127.0.0.1. The lock follows the same rule, plus
the hosted origin for the states the session read cannot express:

| Session read | Non-hosted origin (bench, localhost dev, the e2e server) | Hosted origin (`environmentForOrigin(origin)` is staging or production) |
|---|---|---|
| `signed-in` | open | open |
| `signed-out`, `signIn: true` | **locked, sign-in dialog** (this is how e2e tests it) | locked, sign-in dialog |
| `signed-out`, `signIn: false` | open (today's page) | locked, "Sign-in opens on this site soon" |
| `checking` | open | scrim only |
| `unavailable` | open | locked, dialog with the retry line |

The bench build never reads the session (`mount.ts` skips it), so it stays `checking` on a non-hosted origin: open. A
Worker outage on staging keeps the lock. Existing e2e specs that stub a signed-out `signIn: true` session to exercise
browser-only flows (`project-zip`, `browser-sync`, the first-visit tests in `live-entry`) change with this slice: those
flows no longer exist for signed-out visitors where sign-in is offered, so the specs sign their stub in, and the
first-visit card and its tests are replaced by the gate and its tests. The security result never depended on the lock:
Connect is refused by the Worker (`authGate.ts`) whatever the page shows.

### 5.2 The dialog

Exactly the mockup, minus the safety line the owner struck:

1. the run wordmark, alone, centred;
2. heading "Sign in to use Run";
3. one paragraph: "Run keeps your machines, tools, materials and projects in your Synthetos account. Signing in takes
   one click with GitHub.";
4. one primary button, full width of the dialog, GitHub mark + "Continue with GitHub", an `<a>` to
   `signInHref(currentPath)`;
5. one small line: "New here? The same button creates your Synthetos account." followed by a "What we store" link to
   the accounts privacy page **(call: the URL is whatever accounts.synthetos.com publishes; if none exists yet, the
   link is omitted, not pointed at a placeholder)**;
6. a rule, then a quiet link with a book icon: "What is Run? Read the overview" → the repo README **(call; the owner
   said "a readme.md or something")**.

Dialog frame: 440 px wide, `.dialog` styling (sheet, rule, 10 px radius, `--pop` shadow), 28 px padding, centred text.
It is `role="dialog" aria-modal="true"`, labelled by the heading, focus starts on the button, Tab cycles inside it,
Escape does nothing (there is nowhere to go). The dialog does not scroll the workspace.

**Refused sign-in (call, builder check Q5, corrected while planning).** A refused or failed sign-in never comes back
to the dialog: run's callback answers with the Worker's existing problem page (`authCallback.ts` `refused` →
`authPages.ts` `authProblem`), and accounts shows its own page for a visitor not on the tester list. No new page state.

### 5.3 The lock

- The scrim is `position: fixed; inset: 0` above the app, `color-mix(in srgb, var(--ink) 38%, transparent)` with a
  1.5 px blur; the orange warning bar stays visible through it (it is content, not chrome). **(owner: dimmed with the
  rest is fine)**
- The app root gets `inert` while locked, so nothing behind is focusable or clickable and screen readers see only the
  dialog. Pause and Stop job are inert too: there is no machine and no session; the D1 rule is about a connected machine,
  which a signed-out page cannot have (Connect is refused by the Worker, `authGate.ts`).
- Theme toggle and the level switch are behind the lock as well; the theme still follows the saved preference.
- Nothing is written to browser storage by the locked page except what the page already writes today (theme,
  `device-safety`).

### 5.4 After sign-in

The return path brings the visitor back to the page they were on (`/auth/login?return_to=`, Worker rule unchanged).
The page re-reads the session, the lock lifts, and section 6 decides whether the wizard opens.

### 5.5 No browser-to-account copy **(owner, 2026-11-17: "we are starting from scratch")**

Run opens with accounts; nobody has browser-only records worth carrying over. The "Copy what's in this browser to
your account?" dialog and the copy flow behind it go. A signed-in page writes account records only: a machine or
project left in browser storage from before go-live stays listed beside the account's, is never uploaded and is never
deleted by Run, and while one is listed the library's saved line says "Saved in this browser" rather than "Saved to
your account" (builder's call, 2026-11-17: hiding them would rework the sync bindings for records nobody has). The
local store stays for the non-hosted bench channel (5.1: a non-hosted origin is open and local).

## 6. The setup wizard **(owner: seven steps, wide, fixed frame)**

### 6.1 When it opens

On a signed-in page when the account has **no machine record** (`RECORD_KINDS` `machine` count is zero) and the account
has not dismissed the wizard. Dismissal and progress live in a small per-account record so the wizard resumes on any
browser **(call: a new record kind `setup`, one document, under `RECORD_MAX_BYTES`; there is no existing per-account
preferences record, so this is a new kind, with the D1 migration that the `kind` CHECK constraint needs (see
`workers/run-data/migrations/0002`), the contracts, both Workers' readers, `recordReaders.ts` and the sync counts, and
both Workers deployed before the page writes it; browser storage alone is not acceptable because the
owner's test is "sign in from another machine and carry on")**. "Run setup again" lives in Preferences.

**Precedence with the browser-library import (call, builder check Q6).** When sign-in finds browser-local records and
the account has not consented to importing them (`librarySync.ts` `ask`), that prompt (`SyncNotice.ts`) comes first.
The wizard evaluates its open rule only after the import is accepted or declined and the record counts have refreshed;
if the import brought a machine, the wizard does not open. Two modals never show at once.

**Accounts that cannot connect (call, builder check Q5).** The wizard opens for every signed-in account. When
`canConnect` is false, steps 2 to 4 show the existing one line ("Connecting is open to testers for now.") where the
Connect button would be; a machine record can still be created and named, and firmware and homing collapse to that
line plus Next.

### 6.2 Frame

One panel, 960 × 520 px, `.dialog` styling, centred over the dimmed workspace (same scrim as the front door, same
`inert` on the app). Left rail 210 px on `--paper` with the run wordmark (26 px high) and the seven steps as a numbered
list: done steps get a green check, the current step a blue filled number, later steps a hollow number. Content area
has 28 px top, 34 px side padding, a 22 px heading, a 14 px muted lead. Footer row: "Skip for now" (quiet button) on the
left for skippable steps, the primary action on the right, separated from the content by a rule. **The frame never
changes size between steps**; a step that needs more room gets a layout that fits the frame, not a bigger frame.

Below 1024 px wide the panel becomes full-screen with the rail collapsed to a top strip of seven dots and the current
step's name **(call)**. Nothing in the wizard requires a mouse.

### 6.3 Steps

Each step reuses the existing dialogs and models rather than cloning them; the wizard is composition, not a second copy
of machine or tool editing. Fields are sized to their content (three-digit fields are about 96 px plus the unit; the
machine name about 300 px; the board picker about 200 px). Options are radio cards at natural width, max 440 px.

1. **Welcome** (not skippable). Heading "Welcome to Run", lead "Your Synthetos account is ready. One sign-in now covers
   three things.", a three-item list (Run with its account storage; the forum, post and reply as you; bug reports filed
   from Run to GitHub), the line "Setup takes about five minutes. Every step can be skipped and finished later from
   Preferences.", primary "Set up my machine".
2. **Your machine.** A **machine template** picker (the templates Machines already has: Shapeoko, X-Carve, custom;
   the picker in the mockup labelled "Board" is this **(call, builder check Q4)**), machine name, bed width / depth /
   thickness in mm with defaults from the template, the board itself detected on connect (hardware version from the
   board's identity, stored on the record with the board id), then a Connect button using the existing Connect flow and
   its own status line ("Connected · TinyG 450.06 · board 2X3559… · usbserial-…"). Primary "Next: firmware" is
   enabled once a machine record is saved; connecting is encouraged, not required **(call)**.

   **More than one board on the bench (owner question, 2026-11-16).** The browser's port chooser shows every port, so
   the user picks one; Run cannot tell boards apart before connecting (Web Serial exposes vendor and product ids only).
   After connecting, Run reads the board's unique id (the `identity.id` the status line already shows) and the machine
   record stores it. Rules:
   - A machine record binds to one board id. The wizard sets up **one machine**; the step ends with the line "More
     boards? Add each one later from Machines, the same way." **(call)**
   - If the connected board's id already belongs to a machine in the account, the step says so ("This board is
     *Shapeoko on the bench*") and offers to continue with that machine instead of creating a second record.
   - If the user connects a different board later in the wizard (homing, firmware), the step shows the board id and
     name it is talking to, so two boards never get mixed up; a step that was started on board A refuses to finish on
     board B with a one-line reason.
   - The status line always shows the board id, shortened, next to the port name, in the wizard and on the Board page.
3. **Firmware** **(owner: "the wizard should have a firmware update step" and "we should not allow Run to run if they
   don't update")**. Needs a connected board; otherwise the step says "Connect the machine to check its firmware" and
   is skippable. Shows the connected firmware build and the newest release Run supports (from the verified release list
   `updateOffer.ts` already reads; there is no separate pinned edge). Run already decides this in
   `firmware/updateOffer.ts`: `firmwareNeeded` makes the offer kind `needed` (below what Run can control) or
   `available` (supported, a newer release exists). The step follows that decision exactly, with no second rule:
   - **needed** (below the minimum Run controls): the step is **not skippable** and "Next: homing" stays disabled.
     The text is the existing `offerText` ("Run can't control firmware 450.03. Install 450.06, the newest release Run
     supports."), the primary is "Update firmware", which runs the existing update flow in place (progress, settings
     backup and restore, recovery, bootloader rules unchanged, never automatic). The only other way out is to close the
     wizard, and the Board page then refuses control as it does today, so the user cannot run a job on old firmware
     either way.
   - **available** (supported, newer released): the offer text, one or two lines on what changes, "Update firmware" as
     the primary and "Next: homing" enabled. Skippable; a skipped update is offered again on the Board page as today.
   - **no offer** (up to date, or no listed release applies): one line, "Next: homing".
   The walkthrough must show a `needed` update running on bench 2 with the step refusing to advance until it is done.
4. **Homing** **(owner, 2026-11-17: choice only; the wizard never writes TinyG settings)**. Needs a connected board (same line and skip rule as Firmware). Two radio cards: "Limit switches fitted" (homing seeks each switch, then backs off) and "No limit
   switches" (you set the home position by hand; Run remembers it for this machine). The choice writes the machine
   record's homing setting that the Board page already understands. "Home now" runs the existing homing flow with Pause
   and Stop visible; with no switches the button is "Set machine zero here" and calls the existing set-zero action.
   Disabled, with a one-line reason, when no machine is connected. Skippable.
5. **Tools and stock.** Two cards side by side. Tools: one line of explanation, the chosen tool if any, "Add from
   catalog" (opens the existing catalog picker) and "Create a tool" (opens the existing tool editor). Stock: width,
   depth, thickness in one row. There is no stock record and machines carry no stock (`Stock` lives in a job or
   project setup), so "Add stock" keeps the stock in the **setup record** with the builtin MDF material as its
   `materialRef` **(call, builder check Q2)**; step 6 writes it into the project it creates, and if step 6 is skipped
   the setup record keeps it and the new-project dialog offers it as the default stock until a project uses it. Primary
   "Next: project". Skippable.
6. **First project.** Two pick cards: **Demo project** and **New project**. Demo: a small named part whose G-code, tool
   and stock already match, created as a real project in the account (copy, not reference) so it can be edited or
   deleted like any other. The demo creates the records it references when they are missing, so it is complete even
   when step 5 was skipped: the catalog ¼" two-flute tool as a `tool` record, the builtin MDF material by its builtin
   id, the stock from step 5 or the demo's own 180 × 120 × 6.35 mm **(call, builder check Q7)**. Unlike the existing
   samples, the demo is a tested program: the sanitizer and the analyze engine pass it in unit tests. New: opens the existing new-project dialog. Primary "Open project". Skippable.
7. **You are set** (not skippable). "Name plate is open on the Job page" (or the project's name), one line on what to
   do next ("Place the job on the stock, check it, then run it."), primary "Go to the Job page". Below it a **"More
   to set up" list** of topics the wizard did not cover, each a collapsed row that expands to two or three lines and a
   link to the place in Run where it is done **(owner, 2026-11-17: "more topics at the end of the wizard that we can
   expand on")**. The topic list is data (one file), starts with what Run supports today (materials and feeds, work
   zero and probing, feed override, firmware backups, projects and zip export, reporting a problem) and grows as TinyG
   firmware capabilities and Run features are reviewed. Each row is the seed of a future help-system article; the
   help system itself is documented separately (`docs/design/HELP_SYSTEM.md`, written with this work, built as we go)
   and is not part of these slices.

### 6.4 The demo project **(call, open to the owner)**

A **name plate**: 60 × 30 mm pocket 1.5 mm deep with the text "run" engraved, cut from a 180 × 120 × 6.35 mm stock with
a ¼" two-flute flat end mill (the catalog tool), feeds conservative for MDF. Work zero front-left-top, the same
convention as the existing `samples.ts` mounting plate. It is generated code like the other samples, checked by the
sanitizer in tests, and small enough to run as a dry run with the spindle off. The builder may replace the geometry if
the sanitizer or the analyze engine objects; the owner should see the result in the walkthrough.

### 6.5 What the wizard writes

Only through the existing account record paths (`records.ts` kinds `machine`, `tool`, `material`, `project`) plus the
setup record. The machine record gains the board id it is bound to (section 6.3 step 2). It never writes to browser-only storage for things that belong to the account, and it never bypasses the
record size limits.

## 7. Job page cleanup **(owner, relayed by the TinyG session 2026-11-16, confirmed)**

Same slice as the text sweep, behaviour-only, small:

- Remove the top "No file open" bar (Files / Open project / Open a file and the "Draft setup · local draft · …" line).
  Projects live in the left-hand Projects section; the file opens at step 3.
- Keep the five steps (Machine → Stock & workholding → Open & place job → Check → Run). Step 4 "Check" currently hints
  "Open a file", which repeats the confusion; its hint becomes what Check does **(call: "Review the safety verdict")**.
- Keep the footer; delete "Review settings before applying" and "Libraries saved in this browser".
- Remove the reassurance lines: `AccountMenu.MENU_FOOT`, `accountNotice.ACCOUNT_STOPS`, the SetupView "Saved in this
  browser." fine print. The account menu's sync row ("Saved to your account" / "Saved in this browser") stays: it is
  state, not reassurance.
- `accountNotice.ts` `WITHOUT_ACCOUNT` ("what works without an account") becomes unreachable once signed-out visitors
  are locked out on hosted builds; it goes in slice 3 with the front door, not here.

## 8. synthetos.com **(owner)**

The site links to run.synthetos.com using the run wordmark: a Run entry in the main navigation and a short block on the
home page (one sentence on what Run is, the wordmark, the link). The wordmark SVG is copied into the site repo (the site
and Run never import each other; tokens are copied, see `docs/design/tokens.md`). This is a separate slice in the
`synthetos.com` repo with its own gate.

## 9. Slices and order

**Before any of these (owner, 2026-11-17: "first and foremost get real accounts working, not browser only"):**
staging sign-in must work end to end and production must open. On 2026-11-17 the lead found staging's run Worker
reporting sign-in off because the 13 November failed deploy's rollback deleted the staging Worker and its secrets; the
keys are re-installed by the accounts `staging-secrets` workflow, and the staging sign-in test follows. Production
opens through the go-live click list (`.agent-bridge/go-live-click-list.md`). The front door (slice 3) removes the
browser-only mode on hosted builds; until it ships, signed-out visitors keep today's local mode.

Each slice: Codex builds, the other Codex reads against a check list, the lead runs the four suites, screenshots
walkthrough attached, ff-only merge by hash.

0. **Accounts live**: staging keys re-installed, staging sign-in verified by the owner, then the go-live click list.
1. **Front door** (section 5), including the `signIn: false` and `unavailable` variants and the inert lock, so Run is
   account-first on hosted builds as soon as accounts are live. Ships with the logo wordmark in the dialog, which pulls
   the `brand/` SVGs forward.
2. **Logo placements**: icon regeneration, top bar lockup, tab icon, README header.
3. **Job page cleanup and text sweep** (section 7).
4. **Wizard** (section 6): frame and rail first, then steps 1–2, 3, 4, 5, 6–7 and the "More to set up" list as
   separate commits; the demo project last.
5. **synthetos.com link** (section 8), in the site repo.

The owner's acceptance walk, on staging: open staging signed out (dialog, dimmed workspace, nothing clickable behind),
Continue with GitHub, land back signed in, the wizard opens, complete it against bench 2 or skip through it, see the
demo project on the Job page, sign out and in from another browser and see the wizard resume where it was left.

## 10. Left to the builder

- Component layout and file split (within the 400-line rule), where the wizard state machine lives, how the scrim and
  `inert` are shared between the front door and the wizard.
- The exact `setup` record shape and its migration, if a new kind is used.
- Which existing dialogs can be embedded in the frame and which must open on top of it.
- Test plan: unit tests for the three session states, the wizard's open/skip/resume rules and each step's writes; a
  browser test for the lock (nothing behind receives focus or clicks) and for the full wizard with the fake serial
  machine; screenshots.
- Icon generation details (`pnpm gen:icons` input), the README header.
- The site repo slice's placement and copy, within the site's own rules.

## 11. Open to the owner (answer whenever)

- ~~Homing depth~~: decided 2026-11-17, **choice only** (a). The radio picks which button the step shows,
  "Home now" (existing homing flow; if the board's settings have no homing switches the step says so and points to
  the Board page) or "Set machine zero here" (existing action); the choice lives in the setup record.
- The demo part (section 6.4): name plate as proposed, or something you would rather see first.
- The "What we store" link target, if accounts.synthetos.com has no privacy page yet.
- Whether "Set machine zero here" is the right no-switch action in the wizard, or whether that step should only choose
  and leave homing to the Board page.
