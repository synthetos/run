# The setup wizard

A signed-in account with no machine is met by one dialog over the dimmed workspace: the run wordmark, seven
numbered steps down the left, one job per screen. Welcome, your machine, firmware, homing and coolant, tools, a first project,
done. Every step but the first and the last can be skipped. Progress lives in the account, so the wizard resumes
where it was left on any browser. It ends with the demo name plate open on the Job page. Design:
`docs/superpowers/specs/2026-11-16-first-run-design.md` §6 (amended by OD-41 and OD-42); plans and rulings:
`docs/superpowers/plans/2026-11-18-setup-wizard.md`, `docs/superpowers/plans/2026-11-18-wizard-fixes.md`. What the
owner rejected on staging and how it was fixed: `docs/design/WIZARD_FIXES.md`.

**Every picture below is simulated**: the fake-serial test build drives a simulated TinyG board, and the account is
an in-memory stub of the record service. No bench hardware was used. The firmware `needed` shot uses the simulated
unapproved board (450.07 on hardware 8), the same case `firmware-offer.fake-serial.ts` exercises. Opening the port
from the test harness leaves the tab an observer, which is why the Job page shot says "controlled in another tab"; a
person who connects from the wizard never sees that.

## What a first-time user sees

| Step | What happens | Light | Dark |
|---|---|---|---|
| 1 Welcome | What the account now covers and how long setup takes. Focus starts on the heading; Tab reaches the primary. | ![Step 1](screenshots/setup-wizard/step-1-light-1280.png) | ![Step 1 dark](screenshots/setup-wizard/step-1-dark-1280.png) |
| 2 Your machine | A machine template, a name (300 px), the bed's three sizes (96 px plus mm), then the existing Connect flow. Its C1 checklist opens above the frame, never cut to it. Once connected the line shows the board and its id; Next saves the machine record bound to that board. | ![Step 2](screenshots/setup-wizard/step-2-light-1280.png) | ![Step 2 dark](screenshots/setup-wizard/step-2-dark-1280.png) |
| 3 Firmware | The board's build against the verified release list (`firmware/updateOffer.ts` `firmwareStanding`). Here the simulated board runs 450.02 and 450.06 is released: skippable, Next on. "Current" only when the list is loaded and names nothing newer. | ![Step 3](screenshots/setup-wizard/step-3-light-1280.png) | ![Step 3 dark](screenshots/setup-wizard/step-3-dark-1280.png) |
| 3 Firmware, needed | Below what Run controls: no Skip, Next held, the exact offer text, "Update firmware". On a site with no updater Skip stays and Next is held. When the update cannot run right now the facts stay and one line says why, with "Update firmware" where the Firmware page can help (not idle, read-only, unidentified). | ![Step 3 needed](screenshots/setup-wizard/step-3-needed-light-1280.png) | |
| 3 Firmware, the step (owner 167) | Only the standing: on the board, Run expects, one sentence, and "Update firmware". No release list or updater in the frame, and nothing scrolls at 1280 × 800. | ![Step 3 update](screenshots/wizard-firmware/step-light-1280.png) | ![Step 3 update dark](screenshots/wizard-firmware/step-dark-1280.png) |
| 3 Firmware, the Firmware page | "Update firmware" steps the wizard aside and opens Board → Firmware → Update with the release Run expects marked, and starts that release's flow, so C6 opens (owner 169). The step stays in the setup record. "← Back to setup" is a quiet action at the right end of the Firmware sub-tab row; it stays through C6 and the update, and is disabled while the flash runs ("Wait until the update finishes."), so the wizard never covers the progress. The update offer modal stays away. | ![Firmware page](screenshots/wizard-firmware/firmware-page-light-1280.png) | ![Firmware page dark](screenshots/wizard-firmware/firmware-page-dark-1280.png) |
| 3 Firmware, the update | The page's own flow and texts, unchanged: C6 takes the Update area while open, the warnings beside the boxes, so it fits at 1280 × 800 with nothing scrolling; backups first, then the write. After the reconnect, Back to setup returns to the step, which re-checks the board and offers Next. | ![C6](screenshots/wizard-firmware/confirm-light-1280.png) ![Started](screenshots/wizard-firmware/update-started-light-1280.png) | ![C6 dark](screenshots/wizard-firmware/confirm-dark-1280.png) ![Started dark](screenshots/wizard-firmware/update-started-dark-1280.png) |
| 4 Homing and coolant | Two radio cards, the radio at the left beside the title. The choice is written to the setup record as it is made and never to the board. The wizard never offers Home (OD-41): with switches it points to the Job page; without switches it shows the existing Set machine zero control (no motion). Below, one compact question (OD-43): what is wired to the coolant output, saved on the step-2 machine; it names the Job page's coolant toggle. | ![Step 4](screenshots/setup-wizard/step-4-light-1280.png) | ![Step 4 dark](screenshots/setup-wizard/step-4-dark-1280.png) |
| 5 Tools | Tools only (OD-42). Add from catalog opens the catalog as a whole page; adding a tool there brings the step back with it. Create a tool opens the tool editor above the frame. | ![Step 5](screenshots/setup-wizard/step-5-light-1280.png) | ![Step 5 dark](screenshots/wizard-fixes/step-5-dark-1280.png) |
| 5 Tools, the catalog | The catalog's own layout at the full viewport: every tool listed without a search, filters for maker, size and type, and a search that takes name, size, flutes or part number. | ![Catalog](screenshots/wizard-fixes/step-5-catalog-light-1280.png) | ![Catalog dark](screenshots/wizard-fixes/step-5-catalog-dark-1280.png) |
| 6 First project | The demo name plate, or a new project by name (the field opens inside the card). Open project makes the demo as a real project in the account, on its own 180 × 120 × 6.35 mm MDF, and opens its file. | ![Step 6](screenshots/setup-wizard/step-6-light-1280.png) | ![Step 6 dark](screenshots/wizard-fixes/step-6-dark-1280.png) |
| 7 You are set | The project that is open, one line on what to do next, and the "More to set up" rows, each collapsed with a link to the place in Run where it is done. | ![Step 7](screenshots/setup-wizard/step-7-light-1280.png) | ![Step 7 dark](screenshots/setup-wizard/step-7-dark-1280.png) |
| The Job page | After "Go to the Job page": the name plate open, stock 180 × 120 × 6.35 mm, the machine and bed from step 2. | ![Job page](screenshots/setup-wizard/job-demo-light-1280.png) | |

Below 1024 px the frame fills the page under the W1 safety bar, which stays visible at every width (OD-9), and the
rail collapses to seven dots and the current step's name:

| | Light | Dark |
|---|---|---|
| 1 Welcome | ![Step 1 at 960](screenshots/setup-wizard/step-1-light-960.png) | ![Step 1 at 960 dark](screenshots/setup-wizard/step-1-dark-960.png) |
| 2 Your machine | ![Step 2 at 960](screenshots/setup-wizard/step-2-light-960.png) | ![Step 2 at 960 dark](screenshots/setup-wizard/step-2-dark-960.png) |
| 3 Firmware | ![Step 3 at 960](screenshots/setup-wizard/step-3-light-960.png) | ![Step 3 at 960 dark](screenshots/setup-wizard/step-3-dark-960.png) |
| 4 Homing and coolant | ![Step 4 at 960](screenshots/setup-wizard/step-4-light-960.png) | ![Step 4 at 960 dark](screenshots/setup-wizard/step-4-dark-960.png) |
| 5 Tools | ![Step 5 at 960](screenshots/wizard-fixes/step-5-light-960.png) | ![Step 5 at 960 dark](screenshots/wizard-fixes/step-5-dark-960.png) |
| 6 New project | ![Step 6 at 960](screenshots/setup-wizard/step-6-new-light-960.png) | ![Step 6 at 960 dark](screenshots/setup-wizard/step-6-new-dark-960.png) |
| 7 You are set | ![Step 7 at 960](screenshots/setup-wizard/step-7-light-960.png) | ![Step 7 at 960 dark](screenshots/setup-wizard/step-7-dark-960.png) |

## Where things live

| Piece | File |
|---|---|
| The record kind `setup` (one document per account, id `setup`) | `packages/library/src/setup.ts` (reader), `packages/contracts/src/records.ts`, `workers/run/src/limits.ts`, `workers/run-data/src/store.ts`, `workers/run-data/migrations/0004_setup_records.sql` |
| The record on the page: view signal and writer | `apps/web/src/workspace/cloud/setupSync.ts`, wired in `librarySync.ts` |
| Open, resume and rail rules (pure) | `apps/web/src/wizard/wizardState.ts` |
| Frame, rail, mount, actions | `apps/web/src/wizard/WizardFrame.ts`, `WizardRail.ts`, `SetupWizard.ts`, `setupActions.ts`; styles `apps/web/src/styles/wizard.css` (wizard-owned classes only) plus the app's base input rules in `workspace.css`, which name `.wizard` beside `.app` |
| One file per step | `apps/web/src/wizard/steps/{Welcome,Machine,Firmware,Homing,Tools,FirstProject,Done}.ts` with their pure helpers `machineDraft.ts`, `firmwareStep.ts`, `homingStep.ts`, `toolChoice.ts`; the radio card `PickCard.ts`; the catalog page `CatalogPage.ts` |
| The demo project | `apps/web/src/wizard/demoProject.ts` (program, tool, stock, setup), `createDemo.ts` (writes and opens) |
| "More to set up" rows | `apps/web/src/wizard/moreTopics.ts`; how they seed help articles: `docs/design/HELP_SYSTEM.md` |
| "Run setup again" | Preferences, `apps/web/src/workspace/views/OtherViews.ts` |
| Step 3's way out and back | `setupActions.ts` (`setupAway`, `leaveSetupForFirmware`, `backToSetup`), `BackToSetup.ts` (the action at the end of the Firmware sub-tab row, mounted by `workspace/views/board/firmwareTabs.ts`); every site-wide Update firmware goes through `workspace/updateStart.ts` |
| The shell hook | `AppShell.ts` renders `SetupWizard` beside `SignInGate`; `gate/useShellLock.ts` locks the app for either |

## What the wizard writes

Only account records, through the paths that exist: the machine (with `boardId`, and `coolant` from step 4), the tool entry, the project with
its file and setup, and the setup record itself (`dismissed`, `step`, `done`, `homing`, `toolId`, `machineId`,
`projectId`). It no longer writes `stock` (OD-42); an older record that has one still reads. Nothing goes to browser
storage; nothing is written to the board.

## Rulings made while building

| Ruling | Cost if wrong |
|---|---|
| The wizard opens when signed in, after the first record read, with no dismissal, and either no machine record or a setup record at all (a started wizard, or "Run setup again"). A legacy account with machines and no record never sees it uninvited. | A started wizard shows on every load until finished or closed, which is the resume behaviour the spec asks for. |
| The homing choice lives on the setup record; the board is never written. | None: owner's decision 2026-11-17. |
| The wizard never offers "Home": Pause and Stop are in the machine strip under the wizard's lock (SAFETY §4.1, OD-41). With switches the step points to the Job page; without switches it shows Set machine zero, which does not move the machine. | The spec's "Home now" waits for the Job page; a slice that keeps the strip outside the lock could bring it back. |
| "Update firmware" leaves the wizard for Board → Firmware → Update (owner 167; it replaced the update flow embedded in the frame, whose C6 confirm landed out of view in nested scroll boxes, so the click looked dead). `setupAway` is a page-only flag: a reload brings the wizard back on the same step. While the flash runs, or while the update was started and the session is closed, the step is `updating`: one line, "Show the update", no Skip, Next held. Next unlocks when the board is back and is no longer `needed`. | A person who leaves the Firmware page for another view has to come back to it, or reload, to see setup again. |
| The firmware step reads the board's standing from the release list; the offer only decides whether the update can run now. A `needed` board on a site with no updater keeps Skip and holds Next. | The owner may want `needed` never skippable; then such a person can only Close setup. |
| Steps 3 and 4 name the connected board and refuse another board than the machine's with one line; step 3 then hides "Update firmware" and holds Next. | None visible. |
| A refused "Open project" (a running job, a missing file) still records the project it made; the next press opens that project instead of making another. | None visible. |
| Closing is an X icon in the top-right corner, named "Close setup" for screen readers and on hover (owner 2026-11-19: not a text link); Escape does nothing. Preferences brings it back at step 1. | One extra button. |
| The chosen tool is the newest entry added while step 5 is open, including on a wizard that resumed at step 5. The catalog page closes on the first tool added after it opened. | A tool added elsewhere during the step counts as the choice. |
| The demo tool is defined in code with the catalog's values (id `demo.quarter-2f`); the catalog is not fetched. | A duplicate of one catalog row. |
| There is no new-project dialog in Run; "New project" takes a name in the card and creates it the way Projects does. | None visible. |
| New draft jobs take the seed stock; the job's own Stock step owns stock (OD-42 retired the "setup stock becomes the default" hook). | An account that saved stock in the first wizard loses that default. |
| A conflict on the setup record keeps the account version and drops the local write (the record has one id). | One wizard action lost on a race between two browsers. |

## Testing it locally

The local page is a non-hosted origin, so stub the account and the record service in a browser test as
`tools/e2e/specs/accountRecords.ts` does (`stubAccount`, `fakeRecords`, `setupRecord`); the shared wizard steps are in
`tools/e2e/specs/wizardPage.ts`. Unit tests:
`apps/web/test/{wizardState,wizardFrame,appShellWizard,setupActions,setupSync,machineDraft,firmwareStep,wizardFirmwareAway,homingStep,toolsStep,toolCatalog,connectNoticeC1,demoProject,createDemo,moreTopics,wizardSteps,preferencesSetup}.test.ts`,
`packages/library/test/setup.test.ts`, `workers/run-data/test/kinds.test.ts`. Browser tests and screenshots (the
layout spec measures C1, the radio cards, the catalog page and every step in both themes at 1280 and 960):

```sh
RUN_E2E_FAKE_SERIAL=1 RUN_SCREENSHOTS=1 pnpm --filter @synthetos/e2e exec playwright test -c playwright.fake-serial.config.ts specs/setup-wizard.fake-serial.ts specs/setup-wizard-layout.fake-serial.ts specs/wizard-firmware.fake-serial.ts
```
