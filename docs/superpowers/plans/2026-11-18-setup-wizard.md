# Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in account with no machine is walked through seven steps (welcome, machine, firmware, homing, tools and stock, first project, done) in one fixed 960 × 520 dialog, resumable from any browser through a new per-account `setup` record, ending with the demo name plate open on the Job page.

**Architecture:** A new record kind `setup` (one document per account, id `setup`) is added end to end: library reader, contracts, migration 0004, both Workers, the web record readers and a small `setupSync` module that publishes the account's setup record and machine count as signals and queues writes through the existing sync queue. The wizard lives in `apps/web/src/wizard/`: pure state (`wizardState.ts`), a frame that reuses the gate's scrim and `inert` lock, and one file per step composing existing components (`ConnectNotice`, `FirmwareTab`, `HomeQuick`, `ToolCatalog`, `ToolModal`, the project store). AppShell gains one sibling (`SetupWizard`) and passes the wizard's open state into `useShellLock`.

**Tech Stack:** Preact 11 + signals, vitest, Playwright fake-serial suite, D1/SQLite migrations, TypeScript 6.

**Spec:** `docs/superpowers/specs/2026-11-16-first-run-design.md` §6 (with the lead's corrections below), §4, §5; `docs/design/SIGN_IN_GATE.md`.

## Global Constraints

- Files ≤ 400 lines, functions ≤ 80, complexity ≤ 15, ≤ 4 params; `tools/gates/modularity-baseline.json` only shrinks (AppShell complexity stays ≤ 18).
- Frame 960 × 520 px, `.dialog` styling, same `gate-scrim` and `inert` lock as the front door; left rail 210 px with the wordmark at 26 px; content padding 28 px top / 34 px sides; 22 px heading; 14 px muted lead; footer with "Skip for now" (quiet, left, skippable steps only) and the primary on the right above a rule; the frame never changes size between steps; below 1024 px full-screen with the rail collapsed to seven dots and the current step's name.
- Fields sized to content: three-digit fields ≈ 96 px plus unit; machine name ≈ 300 px; template picker ≈ 200 px; radio cards natural width, max 440 px.
- Steps 1–7 exactly as spec §6.3; the firmware step follows `firmwareNeeded`/`offerText` with no second rule; `needed` is not skippable and Next stays disabled until the offer is gone.
- Homing step is choice only: the wizard never writes TinyG settings (owner 2026-11-17).
- No browser-only storage for account state. Writes go through the account record paths only. Setup record under `RECORD_MAX_BYTES`.
- No reassurance or filler copy. Short sentences. Sentence case. Same-origin links only.
- Edit files only with Edit/Write. Targeted tests only (single vitest files, single Playwright specs). No `pnpm check`, `pnpm test`, `pnpm e2e*`.
- Commits: plain imperative messages, no AI attribution, no trailers.

## Rulings (recorded here, each with the cost if wrong)

- **R1 Open rule.** Signed in, account has zero `machine` records, setup record absent or `dismissed: false`, evaluated only after the first record read has completed (`setupView.refreshed`). No import precedence: slice 1 removed the browser-library import. Cost if wrong: the wizard opens a beat late; never spuriously.
- **R2 Setup record shape.** `{ v: 1, id: 'setup', dismissed, step, done, homing, stock, toolId, machineId, projectId, updatedAt }` (see Task 1). One document, id `setup`. Cost: a migration of the record shape later; it is one document per account.
- **R3 Homing choice** lives in the setup record (`homing: 'switches' | 'none' | null`), never on the machine record or the board (spec §11, owner 2026-11-17).
- **R4 Board id** is a new optional `boardId` text field on `MachineProfile`, accepted by `readMachine`. Cost: one optional field; old records read unchanged.
- **R5 Firmware update in place.** "Update firmware" embeds the existing `FirmwareTab` inside the wizard's content area with the release pre-marked (`releaseRequest`); the whole flow (C6, backups, progress, recovery) is the Board tab's code unchanged. Next unlocks when `updateOffer` no longer returns `needed` for the live snapshot. Cost: a cramped two-column layout in 650 px; the frame scrolls its content region, never grows.
- **R6 Closing.** A quiet "Close setup" button in the frame's top-right writes `dismissed: true` with the progress kept; Escape does nothing (as the front door). "Run setup again" in Preferences writes `dismissed: false, step: 1`. Cost: one extra button.
- **R7 Connect in steps 2–4.** Each renders the existing `ConnectNotice` (full form) when no board is connected; the `canConnect: false` line comes from `ConnectPanel` unchanged.
- **R8 Tool choice.** "Add from catalog" renders the existing `ToolCatalog` inside the content region; "Create a tool" opens the existing `ToolModal` with `entry: null`. The chosen tool is the tool entry added since the step opened (new id in `toolStore`), stored as `toolId`.
- **R9 Demo tool.** The catalog ¼" two-flute tool is defined in `demoProject.ts` with the catalog's values (id `demo.quarter-2f`, 6.35 mm, 2 flutes, flat, carbide) and added to `toolStore` when missing; the catalog is not fetched in the wizard. Cost: a duplicate of one catalog row.
- **R10 New project.** There is no new-project dialog in Run (Projects creates "Project N" directly). The "New project" card has a name field (≈ 300 px) and creates the project through the same `withProjects(s => s.create(name))`; Finish opens Projects on it.
- **R11 Firmware `needed` in the walkthrough** is simulated with the fake-serial board at fb 450.07 hv 8 (the existing `firmware-offer.fake-serial.ts` case). The shot shows the step refusing to advance and the embedded flow opened on the marked release; the full flash is the existing `flasher.fake-serial.ts` path, reused unchanged.
- **R12 Default stock.** When step 6 is skipped, the setup record's stock becomes the stock of every new draft job (`newDraftJob`) until a project uses it (`projectId !== null`). Cost: one computed read in `jobModel.ts`.
- **R13 Demo geometry.** 60 × 30 mm pocket 1.5 mm deep centred on the 180 × 120 × 6.35 mm stock, "run" engraved 0.6 mm into the pocket floor from the wordmark geometry at half scale, one tool, S16000, plunge 300, pocket 1000, engrave 800 mm/min. Owner may replace it.

## Review Focus

1. A second browser resumes mid-wizard while the first browser's write is still pending: the second browser's `step` wins on next write (parent rev from cache). Test in Task 3: `saveSetup` after a `records` refresh uses the refreshed rev.
2. Step 2 Next pressed twice quickly creates two machine records. Test in Task 7: the second press updates the record named by `setup.machineId`.
3. A board connected in step 4 whose id differs from the machine's `boardId`: the step refuses with one line. Test in Task 9.
4. Step 5 stock fields left at zero or negative: "Add stock" stays disabled. Test in Task 10 (`stockFromFields`).
5. The demo project is created while a job is running (`executionLock`): the file is not opened, the project still exists, the step says why. Test in Task 11 (`createDemo` with a lock).

---

### Task 1: The `setup` record reader and the `boardId` machine field (packages/library)

**Files:**
- Create: `packages/library/src/setup.ts`
- Modify: `packages/library/src/machine.ts` (FIELDS, optionIssues, `MachineProfile`)
- Modify: `packages/library/src/index.ts` (exports)
- Test: `packages/library/test/setup.test.ts`, `packages/library/test/machine.test.ts` (add one case; find the existing file with `ls packages/library/test`)

**Interfaces:**
- Produces:
  ```ts
  export const SETUP_RECORD_ID = 'setup';
  export type HomingChoice = 'switches' | 'none';
  export interface SetupRecord {
    readonly v: 1; readonly id: typeof SETUP_RECORD_ID;
    readonly dismissed: boolean;
    /** 1..7: the step to resume on. */ readonly step: number;
    /** Steps finished (not skipped), each 1..7, unique. */ readonly done: readonly number[];
    readonly homing: HomingChoice | null;
    readonly stock: Stock | null;
    readonly toolId: string | null; readonly machineId: string | null; readonly projectId: string | null;
    readonly updatedAt: string; // ISO date-time
  }
  export function readSetup(value: unknown): LibraryResult<SetupRecord>;
  export const EMPTY_SETUP_RECORD: SetupRecord; // dismissed false, step 1, done [], nulls, updatedAt '1970-01-01T00:00:00.000Z'
  ```
  `MachineProfile.boardId?: string` (non-empty, ≤ 64 chars).

- [ ] **Step 1: Write the failing tests**

`packages/library/test/setup.test.ts`:
```ts
it('reads the empty record and a full one', () => {
  expect(readSetup(EMPTY_SETUP_RECORD).ok).toBe(true);
  const full = { ...EMPTY_SETUP_RECORD, dismissed: true, step: 5, done: [1, 2, 3, 4], homing: 'none', stock: STOCK, toolId: 'demo.quarter-2f', machineId: 'm-1', projectId: 'p-1', updatedAt: '2026-11-18T10:00:00.000Z' };
  expect(readSetup(full)).toEqual({ ok: true, value: full });
});
it.each([
  ['wrong id', { ...EMPTY_SETUP_RECORD, id: 'other' }, '/id'],
  ['step out of range', { ...EMPTY_SETUP_RECORD, step: 8 }, '/step'],
  ['done repeats', { ...EMPTY_SETUP_RECORD, done: [2, 2] }, '/done'],
  ['bad homing', { ...EMPTY_SETUP_RECORD, homing: 'maybe' }, '/homing'],
  ['bad stock', { ...EMPTY_SETUP_RECORD, stock: { width: 1 } }, '/stock'],
  ['unknown field', { ...EMPTY_SETUP_RECORD, extra: 1 }, '/extra'],
  ['not an object', 3, ''],
])('refuses %s', (_name, value, path) => {
  const r = readSetup(value); expect(r.ok).toBe(false); if (!r.ok) expect(r.issues.map(i => i.path)).toContain(path);
});
it('is under the record size limit', () => { expect(new TextEncoder().encode(JSON.stringify({ ...EMPTY_SETUP_RECORD, stock: STOCK })).length).toBeLessThan(2048); });
```
`machine.test.ts` addition: `readMachine({ ...machine, boardId: '2X3559-ABCD' }).ok` is true; `boardId: ''` and `boardId: 'x'.repeat(65)` give an issue at `/boardId`.

- [ ] **Step 2: Run to verify failure** — `cd packages/library && pnpm exec vitest run test/setup.test.ts test/machine.test.ts` → FAIL (module not found / boardId refused as unknown field).

- [ ] **Step 3: Implement** `setup.ts` with `readSetup` (strict, unknown fields refused at the root, `readStock` for the stock, `isDateTime` for `updatedAt`, `frozenCopy` result) and the `boardId` field in `machine.ts` (`FIELDS` + `optionIssues`). Export both from `index.ts`.

- [ ] **Step 4: Run to verify pass** — same command → PASS. Also `pnpm exec tsc --noEmit -p packages/library`.

- [ ] **Step 5: Commit** — `git add packages/library && git commit -m "Add the setup record reader and the machine board id"`

---

### Task 2: The `setup` kind in contracts, both Workers and migration 0004

**Files:**
- Modify: `packages/contracts/src/records.ts` (`RecordKind`, `RECORD_KINDS`)
- Modify: `workers/run/src/limits.ts` (`RECORD_KINDS`)
- Modify: `workers/run-data/src/store.ts` (`READERS.setup = readSetup`)
- Create: `workers/run-data/migrations/0004_setup_records.sql` (copy the 0002 rebuild with `CHECK(kind IN ('tool','material','machine','project','setup'))` on both tables, triggers recreated unchanged)
- Test: `workers/run-data/test/kinds.test.ts` (new describe), `workers/run/test/limits.test.ts` (already compares; re-run)

**Interfaces:**
- Produces: `RecordKind` includes `'setup'`; `recordMaxBytes('setup') === RECORD_MAX_BYTES`.

- [ ] **Step 1: Write the failing tests** in `kinds.test.ts`:
```ts
describe('setup records and migration 0004', () => {
  it('store one setup document per account under the 64 KiB limit, and refuse a bad one', async () => {
    const { db, sql } = database(); const store = new RecordStore(db);
    expect(await store.put(a, 'setup', 'setup', null, EMPTY_SETUP_RECORD)).toMatchObject({ ok: true, record: { kind: 'setup', rev: 1 } });
    expect(await store.put(a, 'setup', 'setup', null, { ...EMPTY_SETUP_RECORD, step: 9 })).toEqual({ ok: false, error: 'invalid' });
    expect(await store.put(a, 'setup', 'other', null, EMPTY_SETUP_RECORD)).toEqual({ ok: false, error: 'invalid' }); // id must match
    expect(await store.list(b, 'setup')).toEqual([]);
    sql.close();
  });
  it('0004 widens the kind check and keeps rows, counts and triggers', async () => {
    const { db, sql } = database('0003_files.sql'); const store = new RecordStore(db);
    await store.put(a, 'machine', machine.id, null, machine);
    expect(() => sql.exec("INSERT INTO records VALUES('usr_x','setup','setup',1,NULL)")).toThrow('CHECK');
    const used = sql.prepare('SELECT used_bytes FROM account_storage WHERE user_id=?').get(a.userId)!['used_bytes'];
    sql.exec(migrationSql(migrations().find((m) => m.startsWith('0004'))!));
    expect(await store.get(a, 'machine', machine.id)).toMatchObject({ ok: true, record: { rev: 1 } });
    expect(sql.prepare('SELECT used_bytes FROM account_storage WHERE user_id=?').get(a.userId)!['used_bytes']).toBe(used);
    expect(await store.put(a, 'setup', 'setup', null, EMPTY_SETUP_RECORD)).toMatchObject({ ok: true });
    expect(await store.put(a, 'machine', machine.id, null, machine)).toMatchObject({ ok: false, error: 'conflict' }); // revision_cas still there
    sql.close();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd workers/run-data && pnpm exec vitest run test/kinds.test.ts` → FAIL. `cd workers/run && pnpm exec vitest run test/limits.test.ts` → passes now, fails after contracts change until limits.ts follows.

- [ ] **Step 3: Implement** contracts, limits, store READERS, the migration file.

- [ ] **Step 4: Run to verify pass** — both commands → PASS; `pnpm exec tsc --noEmit -p workers/run-data && pnpm exec tsc --noEmit -p workers/run && pnpm exec tsc --noEmit -p packages/contracts`.

- [ ] **Step 5: Commit** — `git commit -m "Add the setup record kind to the contracts, both Workers and migration 0004"`

---

### Task 3: Web record readers and `setupSync` (publish, count, write)

**Files:**
- Modify: `apps/web/src/workspace/cloud/recordReaders.ts` (`setup: readSetup`; `AccountContent` union adds `SetupRecord`)
- Create: `apps/web/src/workspace/cloud/setupSync.ts`
- Modify: `apps/web/src/workspace/cloud/librarySync.ts` (three lines: connect, publish on `show`, mark refreshed on the runner's change, reset on stop)
- Modify: `apps/web/src/workspace/cloud/libraryRecords.ts` `browserCopy` (a `setup` record has no name: return `{ ...content, id }`), and check `queueConflict.ts` keeps the account version for `setup`.
- Test: `apps/web/test/setupSync.test.ts`, `apps/web/test/cloudLibrary.test.ts` (add: `isRecordKind('setup')` true; a setup record survives `validCache`)

**Interfaces:**
- Produces:
  ```ts
  export interface SetupView { readonly record: SetupRecord | null; readonly machines: number; readonly refreshed: boolean; readonly account: boolean }
  export const setupView: Signal<SetupView>;           // account false when no sync is active
  export const defaultStock: ReadonlySignal<Stock | null>; // record.stock while projectId === null
  export function connectSetup(cache: CloudCache, hooks: { persist(): boolean; change(): void }): { show(): void; refreshed(): void; stop(): void };
  export function saveSetup(patch: Partial<Omit<SetupRecord, 'v' | 'id' | 'updatedAt'>>, now?: () => Date): boolean; // false when no account sync
  ```
  `connectSetup` installs the writer `saveSetup` uses: `enqueue(cache, 'setup', 'setup', next)` with `next = { ...(current ?? EMPTY_SETUP_RECORD), ...patch, updatedAt }`, then `persist()`, `change()`.
  `show()` recomputes `setupView` from `visibleRecords(cache)` (record = the `setup` kind document, machines = count of `machine` kind).

- [ ] **Step 1: Write the failing tests** (`setupSync.test.ts`, with `emptyCache()` and the `record()` fixture from `test/syncFixtures.ts`):
```ts
it('publishes nothing before an account, the counts after show, and refreshed after the first read', ...)  // setupView.account false → connect → show: machines 0, refreshed false → refreshed() → true
it('saveSetup merges a patch onto the account record, queues one pending write with the record rev as parent, and bumps updatedAt', ...)  // cache.records has setup rev 3 → saveSetup({ step: 4 }) → cache.pending[0] { kind:'setup', id:'setup', parent: 3, content.step 4, content.done [] }, setupView.record.step 4, persist and change called once
it('a second save before the first is sent replaces the pending write and keeps parent 3', ...)
it('a refresh that brings rev 4 makes the next save use parent 4', ...)   // Review Focus 1
it('saveSetup is false and writes nothing without an account', ...)
it('defaultStock is the record stock until a project uses it', ...)  // stock set, projectId null → stock; projectId 'p' → null
it('stop resets setupView to no account', ...)
```
`cloudLibrary.test.ts`: `expect(RECORD_KINDS).toContain('setup')`; `refusal('setup', { ...EMPTY_SETUP_RECORD, step: 0 })` is a string starting `Not saved to your account: setup:`.

- [ ] **Step 2: Run to verify failure** — `cd apps/web && pnpm exec vitest run test/setupSync.test.ts test/cloudLibrary.test.ts` → FAIL.

- [ ] **Step 3: Implement** `setupSync.ts` and the readers; wire `librarySync.ts`: `const setup = connectSetup(cache, { persist, change })` after `cache` is read; call `setup.show()` at the end of `show()`; in `syncRunner`'s `hooks.change` use `() => { show(); setup.refreshed(); }` (the runner calls `change` only after `read` or a successful write; both mean the account was read); `setup.stop()` in `stop()` and in `unavailable()`.

- [ ] **Step 4: Run to verify pass** — same command plus `pnpm exec vitest run test/librarySync.test.ts test/syncRunner.test.ts` (existing names; adjust to whatever `ls apps/web/test | grep -i sync` shows) → PASS. `pnpm exec tsc --noEmit -p apps/web`.

- [ ] **Step 5: Commit** — `git commit -m "Read and write the account setup record from the page"`

---

### Task 4: Wizard state (pure)

**Files:**
- Create: `apps/web/src/wizard/wizardState.ts`
- Test: `apps/web/test/wizardState.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StepId = 1 | 2 | 3 | 4 | 5 | 6 | 7;
  export interface StepDef { readonly id: StepId; readonly label: string; readonly skippable: boolean }
  export const STEPS: readonly StepDef[]; // Welcome, Machine, Firmware, Homing, Tools & stock, Project, Done; 1 and 7 not skippable
  export function wizardOpen(gate: GateKind, view: SetupView): boolean;            // R1
  export function currentStep(record: SetupRecord | null): StepId;                 // clamp record.step to 1..7
  export function markDone(record: SetupRecord, step: StepId): Pick<SetupRecord, 'step' | 'done'>; // done ∪ {step}, step = min(step + 1, 7)
  export function skip(record: SetupRecord, step: StepId): Pick<SetupRecord, 'step'>;              // step + 1, done unchanged
  export type RailMark = 'done' | 'current' | 'later';
  export function railMarks(record: SetupRecord | null): readonly RailMark[];     // seven entries
  export const NEXT_LABEL: Readonly<Record<StepId, string>>; // 'Set up my machine', 'Next: firmware', 'Next: homing', 'Next: tools & stock', 'Next: project', 'Open project', 'Go to the Job page'
  ```

- [ ] **Step 1: Write the failing tests**
```ts
it('opens only when signed in, refreshed, zero machines and not dismissed', () => {
  const base = { record: null, machines: 0, refreshed: true, account: true };
  expect(wizardOpen('open', base)).toBe(true);
  expect(wizardOpen('sign-in', base)).toBe(false);
  expect(wizardOpen('open', { ...base, refreshed: false })).toBe(false);
  expect(wizardOpen('open', { ...base, machines: 1 })).toBe(false);
  expect(wizardOpen('open', { ...base, account: false })).toBe(false);
  expect(wizardOpen('open', { ...base, record: { ...EMPTY_SETUP_RECORD, dismissed: true } })).toBe(false);
  expect(wizardOpen('open', { ...base, record: { ...EMPTY_SETUP_RECORD, step: 5 } })).toBe(true);
});
it('markDone adds the step and advances; the last step stays 7', ...)
it('skip advances without marking done', ...)
it('railMarks: done steps, the current, the rest later', () => expect(railMarks({ ...EMPTY_SETUP_RECORD, step: 3, done: [1, 2] })).toEqual(['done', 'done', 'current', 'later', 'later', 'later', 'later']));
it('currentStep clamps', ...)
it('STEPS: 1 and 7 are not skippable, the other five are', ...)
```

- [ ] **Step 2: Run to verify failure** — `cd apps/web && pnpm exec vitest run test/wizardState.test.ts`
- [ ] **Step 3: Implement** `wizardState.ts` (imports `GateKind` from `../gate/gateState.ts`, `SetupView` from `../workspace/cloud/setupSync.ts`).
- [ ] **Step 4: Run to verify pass**
- [ ] **Step 5: Commit** — `git commit -m "Add the setup wizard's open, resume and rail rules"`

---

### Task 5: The frame, the rail, the lock and the AppShell hook

**Files:**
- Create: `apps/web/src/wizard/WizardFrame.ts` (pure view: scrim + dialog + rail + content slot + footer + close)
- Create: `apps/web/src/wizard/WizardRail.ts` (pure view)
- Create: `apps/web/src/wizard/SetupWizard.ts` (mount: signals → frame → the step for `currentStep`; steps 2–7 land in later tasks, until then a placeholder `h('p')` per step is acceptable **inside this task only**, replaced task by task)
- Create: `apps/web/src/wizard/setupActions.ts` (`finishStep(step)`, `skipStep(step)`, `closeSetup()`, `restartSetup()` → `saveSetup`)
- Create: `apps/web/src/styles/wizard.css`; import it in `apps/web/src/entries/workspace.ts` after `gate.css`
- Modify: `apps/web/src/gate/useShellLock.ts` → `useShellLock(extra = false)` (locked = gate lock or `extra`)
- Modify: `apps/web/src/workspace/AppShell.ts`: `const { ref: appRoot, lock } = useShellLock(wizardShowing.value)` and `h(SetupWizard, { model, onView })` after `h(SignInGate, null)`
- Test: `apps/web/test/wizardFrame.test.ts`, `apps/web/test/appShellWizard.test.ts`, `apps/web/test/setupActions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // WizardFrame.ts
  export interface FrameProps { readonly step: StepId; readonly marks: readonly RailMark[]; readonly title: string; readonly lead: string;
    readonly primary: { readonly label: string; readonly onClick: () => void; readonly disabled?: boolean; readonly attr?: string };
    readonly onSkip: (() => void) | null; readonly onClose: () => void; readonly children?: ComponentChildren }
  export function WizardFrame(p: FrameProps): ComponentChild;
  // markup: <div class="gate-scrim" aria-hidden> <div class="wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title" data-wizard-step={step}>
  //   <div class="dialog wizard-dialog"> <WizardRail/> <section class="wizard-content"> <h2 id="wizard-title" tabindex="-1">title</h2> <p class="wizard-lead">lead</p> <div class="wizard-body">children</div>
  //   <footer class="wizard-foot"> [button.quiet data-action="wizard-skip"] <button class="primary" data-action="wizard-next"> </footer> </section>
  //   <button class="quiet wizard-close" data-action="wizard-close" aria-label="Close setup">
  // WizardRail.ts
  export function WizardRail(p: { readonly marks: readonly RailMark[]; readonly current: StepId }): ComponentChild; // wordmark 26 px + <ol class="wizard-steps"> li[data-mark] with the number or a check icon; <p class="wizard-dot-name"> shows the current label (CSS shows it only below 1024)
  // SetupWizard.ts
  export const wizardShowing: ReadonlySignal<boolean>; // computed: wizardOpen(pageGate(), setupView.value)
  export function SetupWizard(p: { readonly model: WorkspaceModel | null; readonly onView: (v: string) => void }): ComponentChild; // null when not showing
  // setupActions.ts
  export function finishStep(step: StepId, patch?: Partial<SetupRecord>): void; // saveSetup({ ...markDone(record, step), ...patch })
  export function skipStep(step: StepId): void; export function closeSetup(): void; export function restartSetup(): void;
  ```
  CSS: `.wizard { position: fixed; inset: 0; z-index: calc(var(--z-dialog) + 2); display: flex; align-items: center; justify-content: center }`; `.wizard-dialog { width: 960px; height: 520px; padding: 0; display: grid; grid-template-columns: 210px 1fr; overflow: hidden; border-radius: 10px }`; rail `background: var(--paper); padding: 22px 18px`; content `padding: 28px 34px 0; display: flex; flex-direction: column`; `.wizard-body { flex: 1; min-height: 0; overflow: auto }`; `h2 22px`, `.wizard-lead 14px var(--muted)`; `.wizard-foot { border-top: 1px solid var(--rule); padding: 14px 0 18px; display: flex; justify-content: space-between }`; `@media (max-width: 1023px) { .wizard-dialog { width: 100vw; height: 100vh; grid-template-columns: 1fr; grid-template-rows: auto 1fr; border-radius: 0 } .wizard-steps li span.label { display: none } .wizard-steps { display: flex; gap: 8px } .wizard-dot-name { display: block } }`. Field widths: `.wizard .f-num input { width: 96px }`, `.wizard .f-name input { width: 300px }`, `.wizard .f-pick select { width: 200px }`, `.wizard .pick-card { max-width: 440px }`.

- [ ] **Step 1: Write the failing tests**

`wizardFrame.test.ts` (renderToString or `tree.ts` since the frame is pure):
```ts
it('frame: scrim, dialog labelled by the heading, rail with seven marks, footer with primary; skip only when given', ...)
// data-wizard-step="2", role dialog, aria-modal, h2#wizard-title text, 7 li with data-mark done/current/later, data-action wizard-next label and disabled, wizard-skip present only when onSkip !== null, wizard-close present
it('rail: the wordmark at 26 px and the current step name for the dots strip', ...)  // role img aria-label run; height 26; .wizard-dot-name text
```
`appShellWizard.test.ts` (renderToString like `appShellGate.test.ts`, stub `location` hosted, signed-in state, `setupView.value = { record: null, machines: 0, refreshed: true, account: true }`):
```ts
it('a signed-in account with no machine gets the inert app and the wizard beside it', ...)   // app inert, after contains data-wizard-step="1", not data-gate
it('with one machine record the shell is plain', ...)
it('a dismissed record keeps the shell plain', ...)
```
`setupActions.test.ts` with a stubbed writer (export a test seam from setupSync: `installSetupWriter(fn)` is **not** added; instead connect a real `emptyCache()` via `connectSetup` and assert on `cache.pending`): finishStep(2, { machineId: 'm' }) → pending content step 3, done [2], machineId 'm'; skipStep(3) → step 4, done unchanged; closeSetup → dismissed true, step unchanged; restartSetup → dismissed false, step 1, done [].

- [ ] **Step 2: Run to verify failure** — `cd apps/web && pnpm exec vitest run test/wizardFrame.test.ts test/appShellWizard.test.ts test/setupActions.test.ts test/appShellGate.test.ts`
- [ ] **Step 3: Implement** the four files, the CSS, the `useShellLock` parameter, the AppShell two-line change. Focus: on step change `SetupWizard` focuses `#wizard-title` in an effect (`document.getElementById('wizard-title')?.focus()`), keyed by step.
- [ ] **Step 4: Run to verify pass**; `pnpm exec eslint apps/web/src/wizard apps/web/src/gate apps/web/src/workspace/AppShell.ts`; `pnpm exec depcruise apps/web/src --config .dependency-cruiser.cjs`; `node tools/gates/src/modularity/cli.ts` if present (else the lint config rules cover it).
- [ ] **Step 5: Commit** — `git commit -m "Add the setup wizard frame, rail and the shell lock it shares with the front door"`

---

### Task 6: Step 1 Welcome and step 7 Done with the "More to set up" topics

**Files:**
- Create: `apps/web/src/wizard/steps/Welcome.ts`, `apps/web/src/wizard/steps/Done.ts`, `apps/web/src/wizard/moreTopics.ts`
- Create: `docs/design/HELP_SYSTEM.md`
- Modify: `apps/web/src/wizard/SetupWizard.ts` (route 1 and 7)
- Test: `apps/web/test/wizardSteps.test.ts` (one file for all steps' pure renders; split later if it passes 400 lines), `apps/web/test/moreTopics.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // moreTopics.ts
  export interface Topic { readonly id: string; readonly title: string; readonly lines: readonly string[]; /* 2–3 short sentences */ readonly go: { readonly view: string; readonly label: string } /* onView target */ }
  export const MORE_TOPICS: readonly Topic[]; // materials and feeds (library → materials), work zero and probing (job), feed override (job), firmware backups (board), projects and zip export (projects), reporting a problem (safety)
  // steps
  export function Welcome(): ComponentChild;  // the list of three; the "Setup takes about five minutes…" line (exact spec copy); no reassurance
  export function Done(p: { readonly projectName: string | null; readonly onView: (v: string) => void; readonly onGo: () => void }): ComponentChild;
  // Done: "<name> is open on the Job page" or "No project yet" + "Place the job on the stock, check it, then run it." + <ul class="wizard-topics"> <li><details><summary>title</summary> lines + button data-topic-go>
  ```
  Each step module exports `title` and `lead` constants the frame uses (e.g. `WELCOME_TITLE = 'Welcome to Run'`, `WELCOME_LEAD = 'Your Synthetos account is ready. One sign-in now covers three things.'`, `DONE_TITLE = 'You are set'`, `DONE_LEAD = 'Everything from here is on the Job page.'`).

- [ ] **Step 1: Write the failing tests**
```ts
// moreTopics.test.ts
it('every topic has an id, a title, two or three lines of one sentence each, and a view that exists', () => { for (const t of MORE_TOPICS) { expect(t.lines.length).toBeGreaterThanOrEqual(2); expect(t.lines.length).toBeLessThanOrEqual(3); for (const l of t.lines) expect(l.split('. ').length).toBe(1); expect(['job','library','board','projects','analyze','settings','safety','materials','tools','machines']).toContain(t.go.view); } expect(new Set(MORE_TOPICS.map(t => t.id)).size).toBe(MORE_TOPICS.length); });
it('starts with the six topics the spec names in order', () => expect(MORE_TOPICS.map(t => t.id)).toEqual(['materials-feeds', 'work-zero-probing', 'feed-override', 'firmware-backups', 'projects-zip', 'report-problem']));
// wizardSteps.test.ts
it('Welcome lists the three things and the five-minute line, with no filler', ...)   // text not matching /E-stop|never need|Saved in this browser/
it('Done names the project, one next line, and one row per topic with its link', ...)
```
- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement**; write `docs/design/HELP_SYSTEM.md` (≤ 60 lines: a row in `moreTopics.ts` is the seed of one article: id = slug, title = article title, lines = the summary, `go` = the "Show me" target; how a future help system reads the file; what is not built).
- [ ] **Step 4: Run to verify pass**
- [ ] **Step 5: Commit** — `git commit -m "Add the wizard's welcome and done steps with the more-to-set-up topics"`

---

### Task 7: Step 2 Your machine

**Files:**
- Create: `apps/web/src/wizard/machineDraft.ts` (pure), `apps/web/src/wizard/steps/Machine.ts`
- Modify: `apps/web/src/wizard/SetupWizard.ts` (route 2; the primary saves then `finishStep(2, { machineId })`)
- Test: `apps/web/test/machineDraft.test.ts`, `apps/web/test/wizardSteps.test.ts` (+ Machine render)

**Interfaces:**
- Produces:
  ```ts
  export interface MachineDraft { readonly templateId: string; readonly name: string; readonly width: number; readonly depth: number; readonly thickness: number }
  export function draftFromTemplate(t: MachineTemplate): MachineDraft;       // name as MachinesView copyOf; width = travel.x, depth = travel.y, thickness 19
  export function draftFromMachine(m: MachineProfile): MachineDraft;
  export function draftValid(d: MachineDraft): boolean;                       // name non-empty, three dims > 0
  export function machineFromDraft(d: MachineDraft, base: MachineProfile | null, boardId: string | null, at: string): MachineProfile; // base keeps id/createdAt/axes; new id `m-${templateId}-${at base36}`; bed from placeholderBed with the dims and source placeholder 'From setup'; boardId when given; revision +1 on base
  export function boardOwner(boardId: string | null, machines: readonly MachineProfile[]): MachineProfile | null;
  export function saveDraft(d: MachineDraft, setupMachineId: string | null, boardId: string | null): string; // machineStore.set + selectedMachineStore.set; returns the machine id (Review Focus 2: updates when setupMachineId names an existing machine)
  export function Machine(p: { readonly model: WorkspaceModel | null; readonly draft: MachineDraft; readonly onDraft: (d: MachineDraft) => void; readonly owner: MachineProfile | null; readonly onUseOwner: (m: MachineProfile) => void }): ComponentChild;
  ```
  Markup: `.f-pick` select of `CATALOGUE` (label "Machine"), `.f-name` input, three `.f-num` inputs with `mm`; then `ConnectNotice` (full) when not connected, else the status line `Connected · TinyG 450.06 · board 2X3559… · usbserial-…` from `boardLabel(view)` plus `identity.id` shortened to 6 chars; the owner line "This board is **<name>**" with button `data-action="wizard-use-machine"`; the closing line "More boards? Add each one later from Machines, the same way."

- [ ] **Step 1: Write the failing tests** (`machineDraft.test.ts`): template → draft values (Shapeoko: 425/425/19, 'My Shapeoko'); `draftValid` cases; `machineFromDraft` new vs base (id kept, revision bumped, bed dims, boardId present/absent, `readMachine` ok on the result); `boardOwner` finds by boardId; `saveDraft` twice with the returned id updates one record (`machineStore.value.value.length === 1`). Render test: the select has 6 options, the inputs carry the draft values, no Connect when the model is null (prerender-safe: `ConnectNotice` with model null still renders; assert the Connect region exists), the owner line when given.
- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run to verify pass**; eslint on the wizard dir.
- [ ] **Step 5: Commit** — `git commit -m "Add the wizard's machine step"`

---

### Task 8: Step 3 Firmware

**Files:**
- Create: `apps/web/src/wizard/firmwareStep.ts` (pure), `apps/web/src/wizard/steps/Firmware.ts`
- Modify: `apps/web/src/wizard/SetupWizard.ts` (route 3; skippable unless `needed`; Next disabled while `needed`)
- Test: `apps/web/test/firmwareStep.test.ts`, `wizardSteps.test.ts` (+ Firmware render)

**Interfaces:**
- Produces:
  ```ts
  export type FirmwareState =
    | { readonly kind: 'disconnected' }                       // "Connect the machine to check its firmware." skippable
    | { readonly kind: 'needed'; readonly offer: UpdateOffer } // not skippable, next disabled
    | { readonly kind: 'available'; readonly offer: UpdateOffer }
    | { readonly kind: 'current'; readonly fb: number | null }; // one line "Firmware <fb> is current." skippable
  export function firmwareState(view: LiveView | null): FirmwareState; // uses updateOffer({ snapshot, flashing, flasher, releases, onRunStep: false, fileOpen: false, messageUp: false, showing: true })
  export function firmwareGate(s: FirmwareState): { readonly skippable: boolean; readonly nextEnabled: boolean };
  export function Firmware(p: { readonly model: WorkspaceModel | null; readonly state: FirmwareState; readonly updating: boolean; readonly onUpdate: () => void }): ComponentChild;
  ```
  Markup: a two-row table "On the board / Run expects" (`fbText`), `offerText(offer)` in `p[data-firmware-step="text"]`, primary-in-body button `data-action="wizard-update"` "Update firmware" (needed/available) which sets `releaseRequest.value = offer.release.file` and `updating = true`; when `updating`, `h(FirmwareTab, { model })` inside `.wizard-embed` (scrolls within the body). Disconnected: the line and `ConnectNotice`.

- [ ] **Step 1: Write the failing tests**: build snapshots with the helper the existing `updateOffer` tests use (`ls apps/web/test | grep -i offer`); needed → not skippable, next disabled; available → skippable, next enabled; current → skippable; disconnected → skippable. Render: needed shows the exact `offerText`, no skip in gate, update button present; `updating` renders `data-region="firmware-releases"`.
- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run to verify pass**
- [ ] **Step 5: Commit** — `git commit -m "Add the wizard's firmware step on the existing update offer"`

---

### Task 9: Step 4 Homing (choice only)

**Files:**
- Create: `apps/web/src/wizard/steps/Homing.ts`, `apps/web/src/wizard/homingStep.ts` (pure)
- Modify: `apps/web/src/wizard/SetupWizard.ts` (route 4; Next writes `homing`)
- Test: `apps/web/test/homingStep.test.ts`, `wizardSteps.test.ts`

**Interfaces:**
  ```ts
  export function boardMismatch(connectedId: string | null, machine: MachineProfile | null): string | null; // "This is board <id6>…, not <machine name>'s board <id6>…" when both known and different; else null (Review Focus 3)
  export function Homing(p: { readonly model: WorkspaceModel | null; readonly choice: HomingChoice | null; readonly onChoice: (c: HomingChoice) => void; readonly mismatch: string | null }): ComponentChild;
  ```
  Markup: two `label.pick-card` radios (`name="wizard-homing"`, values `switches` / `none`) with the spec's two texts; below, `h(HomeQuick, { model })` when connected (the existing Home / Set machine zero buttons with their confirmations; `HomeQuick` already disables with the reason when not at rest; it needs no change); the mismatch line as `p[role=alert]` and the buttons region hidden when mismatched; disconnected: "Connect the machine to home it." + `ConnectNotice`.

- [ ] **Step 1: Write the failing tests**: `boardMismatch` null when either unknown or equal, text when different; render: two radios, the checked one follows `choice`, `HomeQuick` region present only when connected (use a `model` whose `live.value` is `INITIAL_LIVE_VIEW` vs a connected view fixture from existing tests, `grep -l "IDLE_UNHOMED" apps/web/test/*.ts | head`).
- [ ] **Step 2–5** as before; commit `git commit -m "Add the wizard's homing step as a choice"`.

---

### Task 10: Step 5 Tools and stock

**Files:**
- Create: `apps/web/src/wizard/steps/ToolsStock.ts`, `apps/web/src/wizard/stockFields.ts` (pure)
- Modify: `apps/web/src/wizard/SetupWizard.ts` (route 5; "Add stock" → `saveSetup({ stock })`; tool chosen → `saveSetup({ toolId })`)
- Modify: `apps/web/src/workspace/jobModel.ts` `newDraftJob`: `jobFromSetup({ ...SEED_SETUP, stock: defaultStock.value ?? SEED_SETUP.stock }, …)` (R12)
- Test: `apps/web/test/stockFields.test.ts`, `wizardSteps.test.ts`, `apps/web/test/jobModel*.test.ts` (one case: `defaultStock` set → `newDraftJob().setup.stock.width`)

**Interfaces:**
  ```ts
  export interface StockFields { readonly width: string; readonly depth: string; readonly thickness: string }
  export const DEFAULT_STOCK_FIELDS: StockFields; // '180', '120', '6.35'
  export function stockFromFields(f: StockFields): Stock | null; // null unless all three parse > 0 (Review Focus 4); shape block, MDF ref as SEED_SETUP, position SEED_SETUP's, zero front-left top
  export function fieldsFromStock(s: Stock | null): StockFields;
  export function newToolSince(before: readonly ToolEntry[], after: readonly ToolEntry[]): ToolEntry | null;
  export function ToolsStock(p: { readonly tool: ToolEntry | null; readonly stock: Stock | null; readonly fields: StockFields; readonly onFields: (f: StockFields) => void; readonly onAddStock: () => void; readonly onCatalog: () => void; readonly onCreate: () => void; readonly catalogOpen: boolean; readonly creating: boolean; readonly onCloseModal: () => void }): ComponentChild;
  ```
  Markup: two `.wizard-cards` cards; Tools: the line "One to start with. The catalog knows the Synthetos and common end mills; a new tool asks for diameter, flutes and length.", the chosen tool as `T<n> · <toolDisplayName>` + "from catalog" / "created", buttons `data-action="wizard-catalog"` / `wizard-create-tool`; when `catalogOpen` the card is replaced by `h(ToolCatalog, { active: true })` in `.wizard-embed` with a "Back" quiet button; `creating` renders `h(ToolModal, { entry: null, onClose })`. Stock: three `.f-num` inputs (Width, Depth, Thickness, `mm`), button `data-action="wizard-add-stock"` disabled when `stockFromFields` is null; after save the button reads "Stock saved".

- [ ] Steps 1–5 as before (tests: `stockFromFields` valid/invalid/zero/negative/blank, `newToolSince` picks the id not in `before`; render asserts the widths classes and the disabled state); commit `git commit -m "Add the wizard's tools and stock step"`.

---

### Task 11: The demo project and step 6 First project

**Files:**
- Create: `apps/web/src/wizard/demoProject.ts` (pure: `DEMO_TOOL`, `demoGcode()`, `DEMO_STOCK`, `demoFile()`, `demoSetup(machine, toolEntry, stock)`)
- Create: `apps/web/src/wizard/createDemo.ts` (effects: add the tool when missing, `withProjects(create → add(file) → setSetup)`, `openProjectFile`, returns `{ ok, projectId, name, reason? }`)
- Create: `apps/web/src/wizard/steps/FirstProject.ts`
- Modify: `apps/web/src/wizard/SetupWizard.ts` (route 6: "Open project" runs `createDemo` or `createNamed`, then `finishStep(6, { projectId })` and `onView('job')`)
- Test: `apps/web/test/demoProject.test.ts`, `apps/web/test/createDemo.test.ts`, `wizardSteps.test.ts`

**Interfaces:**
  ```ts
  export const DEMO_NAME = 'Name plate';
  export const DEMO_TOOL: Tool;   // id 'demo.quarter-2f', version 1, name '1/4" 2-flute end mill', type flat, geometry { diameter 6.35, shank 6.35, flutes 2, fluteLength 19, overallLength 50, stickout 25 }, carbide, uncoated, manufacturer 'Synthetos catalog', partNumber 'CAT-2F-0250', empty lists
  export const DEMO_STOCK: Stock; // 180 × 120 × 6.35, MDF, zero front-left top, position as SEED_SETUP
  export function demoGcode(): string; // R13; ASCII; '(name-plate.nc - demo - 2 operations)', '(01 Pocket - T1 6.35 mm end mill)', '(02 Engrave run - T1 6.35 mm end mill)'; G21 G90 G17 G94; T1 M6; S16000 M3; ends M5, G0 Z15, G0 X0 Y0, M30
  export function demoFile(): File;  // 'name-plate.nc'
  export function demoSetup(machine: MachineProfile | null, tool: ToolEntry, stock: Stock): ProjectSetup; // machine ref, stock ref { id: 'stock', name: 'Block 180 × 120 × 6.35 mm' } + stockSnapshot, material ref builtin.mdf (name 'MDF', version), tools [{ id, version, name, number }]
  export interface CreateResult { readonly ok: boolean; readonly projectId: string | null; readonly name: string; readonly reason: string | null }
  export function createDemo(deps?: { readonly projects: typeof withProjects; readonly open: typeof openProjectFile; readonly lock: () => string | null }): Promise<CreateResult>;
  export function createNamed(name: string, deps?): Promise<CreateResult>;  // R10
  export function FirstProject(p: { readonly choice: 'demo' | 'new'; readonly onChoice: (c: 'demo' | 'new') => void; readonly name: string; readonly onName: (n: string) => void; readonly error: string | null }): ComponentChild;
  ```
  Primary label is 'Open project' (demo) or 'Create project' (new).

- [ ] **Step 1: Write the failing tests**

`demoProject.test.ts`:
```ts
it('the demo program is ASCII, two operations, one tool, and reads as a job card expects', () => { const text = demoGcode(); expect([...text].every(c => c.charCodeAt(0) < 128)).toBe(true); const facts = fileFacts(new TextEncoder().encode(text)); expect(facts.toolChanges.map(t => t.tool)).toEqual([1]); expect(facts.operations.map(o => o.name)).toEqual(['Pocket', 'Engrave run']); expect(facts.spindle).toEqual([16000]); });
it('the sanitizer passes it with no blocking finding', () => { const r = analyseBytes(new TextEncoder().encode(demoGcode()), { dialect: 'tinyg-en', mode: 'full' }).result; /* assert the sanitizer report in the result has no severity "block" entry; find the field name in apps/web/src/gcode-worker/pipeline.ts */ });
it('the analyze engine accepts it: operations with the tool and no file problem', () => { const file = advisorFile(preview(demoGcode())); expect(file.problem).toBeNull(); expect(file.operations.map(o => o.tool)).toEqual([1, 1]); });
it('stays inside the stock and the pocket depth', () => { /* parse X/Y/Z words: 0 ≤ X ≤ 180, 0 ≤ Y ≤ 120, Z ≥ -2.1 and the lowest Z is -2.1 */ });
it('the demo tool, stock and setup are valid library records', () => { expect(readTool(DEMO_TOOL).ok).toBe(true); expect(readStock(DEMO_STOCK).ok).toBe(true); const setup = demoSetup(null, { number: 1, store: null, tool: DEMO_TOOL }, DEMO_STOCK); expect(readProject({ ...emptyProject, setup }).ok).toBe(true); });
```
`createDemo.test.ts` with a fake `withProjects` over `makeProjectStore(memoryRecordStore())` (see `projects/browserStore.ts` and `storage.ts`), a recorded `open`, and `lock`: creates the project with one gcode file and the setup, adds `demo.quarter-2f` to `toolStore` once (second call does not duplicate), opens the file; with `lock() !== null` the project is created, `open` is not called, `ok` false with the lock text as `reason` (Review Focus 5). `createNamed('')` → 'Untitled project' per the store's rule.

- [ ] **Step 2: Run to verify failure** — `cd apps/web && pnpm exec vitest run test/demoProject.test.ts test/createDemo.test.ts`
- [ ] **Step 3: Implement.** The engraving: the wordmark geometry paths from `apps/web/src/brand/wordmarkGeometry.ts` scaled by 0.5 and translated so the 56 × 24 unit box sits centred in the pocket (pocket x 60..120, y 45..75): `r` stem `G1`, shoulder `G3`/`G2` quarter arc; `u` stems and a half arc; `n` stem, arch arc, stem; the dotted rapid stem is engraved as a plain line (the dots are a logo device). Y is up in G-code and down in SVG: flip. If the sanitizer or the analyze engine objects to an arc, replace it with straight chords and record a Ruling.
- [ ] **Step 4: Run to verify pass**
- [ ] **Step 5: Commit** — `git commit -m "Add the demo name plate project and the wizard's first project step"`

---

### Task 12: Preferences "Run setup again"

**Files:**
- Modify: `apps/web/src/workspace/views/OtherViews.ts` (`PreferencesView`: a `panel` "Setup" with one line "Walk through machine, firmware, homing, tools and a first project again." and `button.small[data-action="run-setup-again"]` "Run setup again", shown when `setupView.value.account`)
- Test: `apps/web/test/preferencesSetup.test.ts` (renderToString: the button is present with an account and absent without; clicking calls `restartSetup` — assert the pending write via `connectSetup` on an `emptyCache()`)

- [ ] Steps 1–5; commit `git commit -m "Offer Run setup again in Preferences"`.

---

### Task 13: The walkthrough browser spec and screenshots

**Files:**
- Create: `tools/e2e/specs/setup-wizard.fake-serial.ts`
- Create: `tools/e2e/specs/accountRecords.ts` (helper: `stubAccount(page, { canConnect: true })` routes `/api/session` and `/api/identity`; `fakeRecords(page, seed: CloudRecord[])` routes `/api/records/**` with GET lists per kind and PUT that stores `{ ...content }` as rev+1 and answers `{ record }`; `/api/files/**` answers 204/201 as `filesClient.ts` expects; returns the Map for assertions)
- Create: `docs/design/SETUP_WIZARD.md`
- Output: `docs/design/screenshots/setup-wizard/*.png`

Tests (each a `test(...)`; `RUN_SCREENSHOTS=1` writes the pictures; viewport 1280 × 800 unless stated):
1. `opens for a signed-in account with no machine, after the records are read; not with a machine; not when dismissed` — three page loads.
2. `walks all seven steps with the fake board, saves the setup record on each step and opens the demo on the Job page` — step 1 shot `step-1-light-1280`; step 2: pick Shapeoko, name "Shapeoko on the bench", connect through the worker (`machineWorker` + `request open` as `firmware-offer.fake-serial.ts`), assert the status line shows the board id, shot `step-2-light-1280`, Next → records Map has a machine with `boardId`; step 3 with the default simulated board (450.01 vs 450.06 = `available`): assert the offer text, shot `step-3-light-1280`, Next; step 4: pick "No limit switches", assert "Set machine zero" button present, shot `step-4-light-1280`, Next; step 5: stock fields, Add stock, "Create a tool" opens the ToolModal, close it, shot `step-5-light-1280`, Next; step 6: demo chosen, shot `step-6-light-1280`, Open project; step 7: shot `step-7-light-1280`, Go to the Job page → `[data-wizard-step]` count 0, `[inert]` count 0, `[data-preview="file-name"]` is `name-plate.nc`, shot `job-demo-light-1280`; the setup record in the Map has `dismissed: false`, `done` [1..7], `projectId` set.
3. `dark: steps 1 and 7` — `emulateMedia dark`, shots `step-1-dark-1280`, `step-7-dark-1280` (reach 7 by seeding a setup record with step 7).
4. `below 1024 px the frame is full-screen with the dots strip` — viewport 960 × 700, seed step 2, assert `.wizard-dialog` box width 960 and the `.wizard-dot-name` visible, shot `step-2-light-960`.
5. `firmware needed (simulated): no skip, Next disabled, Update firmware opens the flow in place` — board `{ fb: 450.07, fv: 0.97, hv: 8, layout: 10002 }` as the offer spec, seed step 3 and a machine record; assert `[data-action="wizard-skip"]` count 0, `wizard-next` disabled, text equals the needed `offerText`; shot `step-3-needed-light-1280`; click `wizard-update`, assert `[data-release="tinyg-450.06.hex"][data-release-focus]` inside `.wizard`, shot `step-3-update-light-1280`.
6. `resume: a page with a setup record at step 5 opens on step 5` and `Close setup dismisses and Preferences brings it back`.
7. `keyboard: focus starts on the heading, Tab never leaves the wizard` (8 tabs, `document.activeElement.closest('.wizard')` non-null).

Walkthrough doc `docs/design/SETUP_WIZARD.md` (≤ 120 lines): what a first-time user sees step by step with each picture inline, which shots are simulated (all; the firmware `needed` one explicitly), where the record lives, how to test locally (the route stubs), the rulings in one table, the tests.

- [ ] **Step 1: Write the spec** (it fails until built: the build is from this branch).
- [ ] **Step 2: Build and run** — `pnpm build && pnpm build:fake-serial && cd tools/e2e && RUN_SCREENSHOTS=1 pnpm exec playwright test --config playwright.fake-serial.config.ts specs/setup-wizard.fake-serial.ts` (with `RUN_E2E_FAKE_SERIAL=1` if the config needs it; check `tools/e2e/src/suite.ts`). Fix what fails; re-run until green.
- [ ] **Step 3: Write `docs/design/SETUP_WIZARD.md`**, check every image path exists.
- [ ] **Step 4: Targeted checks** — `pnpm exec eslint tools/e2e/specs/setup-wizard.fake-serial.ts tools/e2e/specs/accountRecords.ts apps/web/src/wizard apps/web/src/workspace/cloud/setupSync.ts`; `pnpm exec tsc --noEmit -p tools/e2e`.
- [ ] **Step 5: Commit** — `git add tools/e2e/specs docs/design && git commit -m "Add the setup wizard walkthrough and its browser test"`

---

### Task 14: Modularity and bundle checks, ledger

- [ ] `pnpm exec depcruise apps/web/src --config .dependency-cruiser.cjs`
- [ ] `pnpm exec eslint apps/web/src/wizard apps/web/src/gate apps/web/src/workspace/AppShell.ts apps/web/src/workspace/cloud apps/web/src/workspace/views/OtherViews.ts apps/web/src/workspace/jobModel.ts packages/library/src workers`
- [ ] `pnpm exec tsc --noEmit -p apps/web`; `pnpm build`; `node tools/gates/src/bundle/cli.ts --target staging apps/web/dist` (the other-origin scan)
- [ ] Confirm `tools/gates/modularity-baseline.json` is unchanged (`git diff --stat tools/gates`)
- [ ] Hand back: head, commits, rulings, tests run, screenshot paths, unfinished items.
