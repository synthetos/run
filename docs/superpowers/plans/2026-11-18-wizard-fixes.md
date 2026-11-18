# Setup wizard fixes (owner screenshots 145–148) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four wizard screens the owner rejected on staging (C1 checklist, firmware "current", the catalog, radio cards), take stock out of the wizard, and check every step in both themes at 1280 and 960.

**Architecture:** The wizard mounts outside `.app`, so the `.app` base rules for inputs (checkbox and radio reset) never reach it and hosted dialogs are positioned against the wizard frame. One CSS root fix (the wizard gets the same base rules, hosted `.dialog-wrap` is fixed above the frame, wizard rules use wizard-owned classes only) covers 145 and 148. The firmware step computes the board's standing from the release list itself (shared helpers exported from `firmware/updateOffer.ts`) and uses the offer only to decide whether the in-place update can run now. The catalog becomes a full-viewport page inside the wizard's dialog, and the catalog search becomes token-based.

**Tech Stack:** Preact + signals, TypeScript, plain CSS, Vitest (tree and renderToString tests), Playwright fake-serial suite.

**Spec:** `docs/superpowers/specs/2026-11-16-first-run-design.md` §6, `docs/design/SETUP_WIZARD.md`, OD-41 in `docs/ops/owner-decisions.md`; owner words for 145–148 in the lead's brief (copied into OD-42 and `docs/design/WIZARD_FIXES.md`).

## Global Constraints

- Work only in `/Volumes/External/projects/run-wizfix` (branch `wizard-fixes`). No push, merge or deploy.
- Edit files only with the Edit/Write tools. No sed, heredocs or redirection into source files.
- Targeted checks only: single vitest files, `pnpm exec tsc --noEmit -p apps/web`, `pnpm exec eslint <paths>`, depcruise, `pnpm build`, `pnpm build:fake-serial`, single Playwright spec files with `RUN_E2E_PORT=8795`. Never `pnpm check|test|e2e*`.
- ≤400 lines per file, ≤80 per function, complexity ≤15, ≤4 params; `tools/gates/modularity-baseline.json` only shrinks.
- No reassurance or filler copy; short sentences; inputs sized to content; one fixed wizard frame (960 × 520, full-screen below 1024 px).
- Nothing in the wizard starts machine motion (OD-41).
- Commits: plain imperative messages, no AI attribution, no trailers.
- Ledger at `.superpowers/sdd/2026-11-18-wizard-fixes/progress.md`, every ambiguity as `Ruling:` with the cost if wrong.

## Review Focus

1. A board on a release that `updateOffer` refuses to offer right now (busy, read-only, no updater on this site) must never read "current". Pinned in Task 2 tests (`held` states).
2. A needed update on a site with no updater (production has no flasher) must not trap the person: Skip stays, Next is held. Pinned in Task 2 gate test.
3. A dialog the wizard hosts (C1, tool editor, catalog preview and add) must sit above the frame and never be clipped, at 1280 and at 960. Pinned in Task 1 and Task 3 browser tests.
4. Adding a tool from the catalog when a tool was already added earlier in the step must still close the catalog and pick the new tool. Pinned in Task 3 unit test (`catalogAdded`).
5. An old setup record with `stock` must still read, and new drafts must use the seed stock, not the record's. Pinned in Task 4 tests.

---

### Task 1: CSS root fix — hosted dialogs and inputs in the wizard (145, 148, part of 6)

**Files:**
- Modify: `apps/web/src/styles/workspace.css` (the `.app input…` base rules near line 867: add the `.wizard` selectors beside `.app`)
- Modify: `apps/web/src/styles/wizard.css` (wizard-owned classes; `.wizard .dialog-wrap` fixed; `.wizard-dialog` no longer borrows `.dialog`)
- Modify: `apps/web/src/wizard/WizardFrame.ts` (drop the `dialog` class, `h2` gets `class: 'wizard-title'`)
- Create: `apps/web/src/wizard/PickCard.ts`
- Modify: `apps/web/src/wizard/steps/FirstProject.ts`, `steps/Homing.ts`, `steps/Machine.ts`, `steps/Done.ts`
- Test: `apps/web/test/wizardSteps.test.ts`, `tools/e2e/specs/setup-wizard.fake-serial.ts`

**Interfaces:**
- Produces: `PickCard(p: { name: string; value: string; title: string; text: string; checked: boolean; onChange: () => void; children?: ComponentChildren }): ComponentChild` → `label.wizard-pick > input.wizard-pick-radio[type=radio] + span.wizard-pick-title + span.wizard-pick-text`.
- Produces CSS class names: `wizard-field`, `wizard-field-row`, `wizard-num`, `wizard-name`, `wizard-select`, `wizard-unit`, `wizard-title`, `wizard-pick*`.

- [ ] Step 1: failing tree test — FirstProject and Homing render `.wizard-pick` labels whose first child is the radio and that carry `.wizard-pick-title`; no `pick-card` class remains.
- [ ] Step 2: failing browser test in the fake-serial spec — at step 2, put the exact C1 markup ConnectNotice renders (`.dialog-wrap > .dialog > form.live-entry.c1 > label.c1-box > input[type=checkbox]`) into the wizard's connect region (C1 cannot be reached on 127.0.0.1: the advisory refusal comes first), then assert: each checkbox's right edge is left of its label text's left edge (Range rect of the text node), every label text starts at the same x, the checkbox is ≤ 20 px wide, the `.dialog` box lies inside the viewport, and `document.elementFromPoint` at the dialog's centre is inside the dialog. Same at 960. Screenshot `c1-in-wizard-dark-1280`.
- [ ] Step 3: failing browser test — step 6 radio cards: radio left edge < title left edge, |radio centre y − title centre y| ≤ 4 px, title and description share the same left x, card width ≤ 440.
- [ ] Step 4: implement: base rules extended to `.wizard`; `.wizard .dialog-wrap { position: fixed; inset: 0; z-index: 5 }`; wizard rules renamed to wizard-owned classes; `.wizard-body p` and `.wizard-content h2` removed in favour of `.wizard-line` / `.wizard-title`; PickCard grid (radio column auto, text column 1fr, radio aligned to title).
- [ ] Step 5: run `pnpm exec vitest run apps/web/test/wizardSteps.test.ts`, `pnpm build:fake-serial`, the setup-wizard spec. Expected: pass.
- [ ] Step 6: commit "Give the wizard the app's input rules and lift hosted dialogs above its frame".

### Task 2: Firmware standing from the release list (146)

**Files:**
- Modify: `apps/web/src/firmware/updateOffer.ts` (export `newestRelease`, `firmwareStanding`; `offerText` takes `OfferFacts`)
- Modify: `apps/web/src/wizard/firmwareStep.ts`, `apps/web/src/wizard/steps/Firmware.ts`, `apps/web/src/wizard/SetupWizard.ts`
- Test: `apps/web/test/firmwareStep.test.ts`

**Interfaces:**
- Produces: `export type OfferFacts = Pick<UpdateOffer, 'kind' | 'current' | 'release'>`; `newestRelease(releases: FirmwareReleases, hv: number, fb: number, needed: boolean): FirmwareRelease | null` (the candidate filter `updateOffer` already uses); `firmwareStanding(s: Snapshot, releases: FirmwareReleases): OfferFacts | { kind: 'current'; fb: number } | null` (null when hv or fb is missing).
- Produces: `FirmwareState` = `disconnected | updating | checking | list-failed {reason} | needed/available {facts: OfferFacts; offer: UpdateOffer | null; held: HeldReason | null} | current {fb}`; `type HeldReason = 'no-updater' | 'busy' | 'read-only'`.
- Gate: needed with an offer or held `busy`/`read-only` → `{ skippable: false, nextEnabled: false }`; needed held `no-updater` → `{ skippable: true, nextEnabled: false }`; updating as now; everything else skippable with Next on.

- [ ] Step 1: failing tests: `checking` (no hub view, or identity without fb); `list-failed` (releases not ok); `needed`; `available`; `current` only at 450.06 with the list loaded; 449.01 with a loaded list whose newest is 450.06 → not `current` (needed); `available` with `flasher` false → held `no-updater`, a job running → held `busy`, `classification.mode` `readOnly` → held `read-only`; render of a held state shows the facts table, the held line, no Update button and no "current".
- [ ] Step 2: run, expect failures.
- [ ] Step 3: implement. Held lines: `busy` "The machine is not idle. Update from Board → Firmware once it is."; `read-only` "This connection is read-only. Update from Board → Firmware once the machine is idle."; `no-updater` "Firmware updates are not available on this site." `checking` "Checking the firmware against the release list."; `list-failed` "The release list could not load, so the firmware was not checked."
- [ ] Step 4: run `firmwareStep.test.ts` and the existing `updateOffer` tests; expect pass.
- [ ] Step 5: commit "Firmware step: judge the board against the release list, not the offer".

### Task 3: Catalog as a whole page, search without a part number (147)

**Files:**
- Modify: `apps/web/src/workspace/tools/catalog.ts` (`catalogSearchText`, token search in `matchesCatalog`)
- Modify: `apps/web/src/workspace/views/tools/ToolCatalog.ts` (placeholder)
- Create: `apps/web/src/wizard/CatalogPage.ts`, `apps/web/src/wizard/toolChoice.ts` (`newToolSince` moves here)
- Modify: `apps/web/src/wizard/WizardFrame.ts` (`overlay?: ComponentChild` rendered inside `.wizard`, after `.wizard-dialog`), `SetupWizard.ts`, `apps/web/src/styles/wizard.css`
- Test: `apps/web/test/toolCatalog.test.ts`, `apps/web/test/wizardSteps.test.ts`, fake-serial spec

**Interfaces:**
- Produces: `catalogSearchText(tool: Tool): string` (maker, part number, name, type label, description, diameter in mm and as an inch fraction, flutes as "N flute"); `matchesCatalog` keeps its signature; every whitespace token must appear.
- Produces: `catalogFrom = signal<readonly ToolEntry[] | null>(null)` (tools when the catalog opened; null = closed); `catalogAdded(from, tools): ToolEntry | null`.
- Produces: `CatalogPage(p: { onBack: () => void }): ComponentChild` → `div.wizard-catalog[role=region]` with "Back to setup" and `ToolCatalog active`.

- [ ] Step 1: failing unit tests: empty query lists every tool; "1/4" and "6.35" match the ¼" tools; "2 flute" matches two-flute tools only; a name word matches; type label "ball" matches; a part number still matches.
- [ ] Step 2: failing tree test: `catalogAdded` returns the tool added after the catalog opened even when another was added before.
- [ ] Step 3: failing browser test: "Add from catalog" opens `.wizard-catalog` whose box equals the viewport at 1280 and 960; rows show without typing; adding a tool closes the page; step 5 shows `T<n> · <name>`; "Create a tool" opens `.tool-modal` above the frame (not clipped). Screenshots `step-5-catalog-dark-1280`, `step-5-dark-1280`.
- [ ] Step 4: implement; the catalog's preview/add dialogs use the Task 1 fixed `.dialog-wrap`.
- [ ] Step 5: run the three test files and the spec; expect pass.
- [ ] Step 6: commit "Open the tool catalog as a whole page from the wizard and search it by name, size and flutes".

### Task 4: Stock leaves the wizard (147, OD-42)

**Files:**
- Rename: `apps/web/src/wizard/steps/ToolsStock.ts` → `steps/Tools.ts`; delete `apps/web/src/wizard/stockFields.ts` (stock half) and its test's stock cases
- Modify: `wizardState.ts` (label "Tools", `NEXT_LABEL[4]` "Next: tools"), `SetupWizard.ts`, `createDemo.ts` (no stock parameter), `apps/web/src/workspace/cloud/setupSync.ts` (drop `defaultStock`), `apps/web/src/workspace/jobModel.ts` (`newDraftJob` uses `SEED_SETUP`), `packages/library/src/setup.ts` (comment only)
- Modify docs: `docs/ops/owner-decisions.md` (OD-42), spec §6.3 step 5 amendment
- Test: `wizardState.test.ts`, `createDemo.test.ts`, `setupSync.test.ts`, `stockFields.test.ts` → `toolChoice.test.ts`, any jobModel draft test

- [ ] Step 1: failing tests: rail label and Next label; Tools step renders no stock fields and no `wizard-add-stock`; `newDraftJob` ignores a record stock; `createDemo` always uses `DEMO_STOCK`; an old record with `stock` still validates.
- [ ] Step 2–4: implement, run, pass.
- [ ] Step 5: commit "Take stock out of the setup wizard (OD-42)".

### Task 5: Walk every step, both themes, 1280 and 960; walkthrough docs (6)

**Files:**
- Modify: fake-serial spec (dark shots for steps 2–6, 960 shots for steps 3–6), `docs/design/SETUP_WIZARD.md`, screenshots under `docs/design/screenshots/setup-wizard/`
- Create: `docs/design/WIZARD_FIXES.md`, new shots under `docs/design/screenshots/wizard-fixes/`

- [ ] Step 1: run the spec with `RUN_SCREENSHOTS=1`; look at every picture; fix what is broken; list findings in the ledger.
- [ ] Step 2: write `WIZARD_FIXES.md` (one section per owner picture: owner image, new image, what was wrong, cause) and update `SETUP_WIZARD.md`.
- [ ] Step 3: commit "Wizard walkthrough: new screenshots and the fixes write-up".
