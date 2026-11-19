# Board Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every setting a board reports is shown in plain words from a per-firmware data file, every setting Run may write has a control listing its allowed values by meaning, and changes apply through the existing backup, write, read-back and revert path.

**Architecture:** Setting definitions move from TypeScript (`packages/schema/src/overlays/tinygEn.ts`, `apps/web/src/workspace/boardFacts.ts` tables) to versioned JSON files under `packages/schema/settings/`, validated by a JSON schema and loaded by the classified dialect. The Board view renders rows and controls from those definitions through one `SettingControl` component, one pending store (unchanged), one sticky `PendingBar`, and the unchanged apply pipeline.

**Tech Stack:** TypeScript, Preact (`h`), `@preact/signals`, Vitest, Playwright fake-serial suite, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-11-18-board-config-design.md` (read it first; section numbers below refer to it). Mockups: `docs/design/mockups/2026-11-18-board-config-*.png`.

## Global Constraints

- No new write path. Every write goes through `live/settingsApply.ts` and the session's gate (SAFETY §4.6 as amended 2026-11-02, H57 to H63). `ex` is never written (H61).
- Agents run only targeted tests: a named Vitest file or one Playwright spec file. Never `pnpm check`, `pnpm test`, `pnpm e2e*`, mutation runs, or Playwright without a spec file. The main session runs full gates once per merge.
- Small single-purpose modules; no god files. `SettingsUi.ts` (360 lines) is split, not grown. Pass this rule into every agent brief.
- Copy: short sentences; no reassurance filler; inputs sized to content; zebra rows on every table-like list in both themes (`apps/web/src/styles/zebra.css`).
- Tokens (`xsn`, `1mi`) render only at Advanced (OD-13). Plain name first, value spelled out with unit.
- No label, unit, value meaning or risk sentence for a setting in UI code; it comes from the settings file.
- `packages/schema/settings/*.json` and `settings.schema.json` get the same CODEOWNERS entry as `src/overlays/` (owner reviews every change).
- Bench and firmware testing belong to the TG Firmware session. Name checks BC-1 to BC-7 (spec §8); run no hardware.
- Edit files with Edit/Write. Commits: plain imperative messages, no AI attribution.
- Every UI task ends with a first-time-user walkthrough: screenshots of the tab at 1280 in both themes, read-only and approved, under `docs/design/screenshots/board-config/build/` (owner rule: UI changes need a walkthrough, not just tests).

## Review Focus

1. **A board value outside the defined values** (an old build stored `1mi` 3, or a firmware adds switch mode 5): the row reads "Unknown value (3)", no option is shown selected, nothing crashes, and choosing a defined value makes it pending. Test in Task 6.
2. **A dialect with no settings file** (unclassified, g2core): every reported token is listed under "No definition yet", nothing is writable, no exception. Test in Task 5 and Task 11.
3. **Pending changes, then a different board connects** (another `id`): pending changes are discarded and one line says so; they are never applied to the other board. Test in Task 7.
4. **A board reporting inches** (`unit` 0): lengths are labelled in inches, and Review and apply is disabled with "Set the board to millimetres (G21) to change lengths." Test in Task 6.
5. **Test switches when the machine leaves idle** (a job starts in another tab, an alarm, a jog): polling stops within one poll, and the button returns to off. Test in Task 9.

---

## Slice A: setting definitions as data

### Task 1: Settings file schema and loader

**Files:**
- Create: `packages/schema/settings.schema.json`
- Create: `packages/schema/src/settingsDefs/types.ts`, `packages/schema/src/settingsDefs/expand.ts`, `packages/schema/src/settingsDefs/load.ts`
- Create: `packages/schema/test/fixtures/settings/mini.json` (three tokens, one family, one enum, one input)
- Test: `packages/schema/test/settingsDefs.test.ts`
- Modify: `packages/schema/src/index.ts` (exports)

**Interfaces:**
- Produces:
  - `type SettingAccess = 'write' | 'read' | 'forbidden' | 'readout' | 'reserved'`
  - `interface ValueDef { value: number; label: string; help?: string }`
  - `interface WriteDef` = today's `OverlayEntry` minus `key`, `label`, `description`, `unit`, `values`, `src` (fields: `valueType, range, rangeSource, hwAllowed?, e158?, convert, scope, risk, typedConfirm, afterWrite, invalidates, whatGoesWrong`)
  - `interface SettingDefinition { key; label; short; description; unit: Unit; display?: number; values?: readonly ValueDef[]; group: string; tab: string; access: SettingAccess; reason?: string; since?: number; until?: number; src: string; labelSrc?: string; write?: WriteDef }`
  - `interface InputDefinition { id; label; pin; function: string; contact?: string; state?: string; action?: string; note?: string }`
  - `interface GroupDefinition { id; title; explanation }`
  - `interface SettingsFile { format: 'synthetos-settings@1'; dialect; firmware: { family; fb: { min?: number; max?: number }; source }; mode: 'writable' | 'readOnly'; groups; inputs; probeAllowed?: readonly string[]; tokens: ReadonlyMap<string, SettingDefinition> }`
  - `function expandSettingsFile(raw: unknown, fb?: number): SettingsFile` (validates, expands `families`, resolves `enum` references and `{m}`/`{a}`/`{A}` placeholders, filters by `since`/`until`, throws `Error` naming the token on any rule break)
  - `function settingsDefsFor(dialectId: string, fb?: number): SettingsFile | null` (registry of bundled files; null for an unknown dialect)

- [ ] **Step 1: Write the failing tests** in `packages/schema/test/settingsDefs.test.ts`:

```ts
it('expands a family into one definition per instance with its cfgArray line', () => {
  const f = expandSettingsFile(mini);
  expect(f.tokens.get('2mi')?.label).toBe('Motor 2 microsteps');
  expect(f.tokens.get('2mi')?.src).toBe('EN config_app.c:221');
  expect(f.tokens.get('2mi')?.values?.map((v) => v.label)).toEqual(['Full step (1)', 'Half step (2)', 'Quarter step (4)', 'Eighth step (8)']);
});
it('resolves an enum reference', () => expect(expandSettingsFile(mini).tokens.get('xsn')?.values?.[3]?.label).toBe('Homing and limit'));
it('refuses access write without a write object', () => expect(() => expandSettingsFile(withAccessWriteNoWrite)).toThrow(/xsn: access write needs a write object/));
it('refuses a write object in a readOnly file', () => expect(() => expandSettingsFile(readOnlyWithWrite)).toThrow(/readOnly file/));
it('refuses unit enum without values, and values without unit enum', () => { /* two expects, messages name the token */ });
it('refuses an unresolved placeholder', () => expect(() => expandSettingsFile(withPlaceholder)).toThrow(/\{m\}/));
it('drops a token outside since/until for the given fb', () => expect(expandSettingsFile(withSince, 450.04).tokens.has('sso')).toBe(false));
it('validates against settings.schema.json (unknown property refused)', () => expect(() => expandSettingsFile(withExtraField)).toThrow(/additional property/));
it('settingsDefsFor returns null for g2core-edge and an unknown dialect', () => { expect(settingsDefsFor('g2core-edge')).toBeNull(); expect(settingsDefsFor('nope')).toBeNull(); });
```
Variants of `mini` are built in the test by spreading the fixture.

- [ ] **Step 2: Run** `cd packages/schema && pnpm exec vitest run test/settingsDefs.test.ts`. Expected: FAIL, `expandSettingsFile` not exported.
- [ ] **Step 3: Write `settings.schema.json`** using only the keywords `jsonSchema.ts` implements (no `oneOf`, `if`): `additionalProperties: false` everywhere, `write` as its own `$defs` object with every `WriteDef` field required except `hwAllowed` and `e158`, `access` an `enum`, `format` a `const`. Cross-field rules are the loader's.
- [ ] **Step 4: Implement** `expand.ts` (pure) and `load.ts` (registry keyed by dialect id; files imported with `import x from '../../settings/<file>.json' with { type: 'json' }` as `boards.ts` does). The registry is empty in this task except the test hook.
- [ ] **Step 5: Run** the test file. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Add the settings definition schema and loader"`.

### Task 2: tinyg-450.json carries the reviewed overlay (safety review)

**Files:**
- Create: `packages/schema/settings/tinyg-450.json` (dialect `tinyg-en`, `fb.min` 450.02, `mode` writable): every key in `TINYG_EN_OVERLAY` with its `write` object, plus the 450.05 and 450.06 deltas from `firmware45005.ts` and `firmware45006.ts` as `since`/`until`
- Modify: `packages/schema/src/settingsSchema.ts` (`buildSettingsSchema` takes `SettingsFile` write entries; `SETTINGS_SCHEMAS['tinyg-en']` and the 450.05/450.06 variants built from `settingsDefsFor('tinyg-en', fb)`)
- Modify: `packages/schema/src/overlays/tinygEn.ts` (becomes `export const TINYG_EN_OVERLAY = overlayFromDefs(settingsDefsFor('tinyg-en'))`, kept only so existing imports and `overlay.test.ts` keep working; deleted in Task 5)
- Create: `packages/schema/src/settingsDefs/overlay.ts` (`overlayFromDefs(f: SettingsFile): readonly OverlayEntry[]`)
- Modify: `.github/CODEOWNERS` (the two new paths)
- Test: `packages/schema/test/settingsGolden.test.ts`, `packages/schema/test/fixtures/settings/overlay-golden.json`

**Interfaces:**
- Consumes: `settingsDefsFor`, `SettingsFile` (Task 1).
- Produces: `overlayFromDefs(f: SettingsFile): readonly OverlayEntry[]`; `settingsSchemaFor` unchanged in signature and behaviour.

- [ ] **Step 1: Freeze the golden.** Before changing any source, write `overlay-golden.json` from the current `TINYG_EN_OVERLAY` and the 450.05/450.06 schema settings (a one-off script in the scratchpad, output committed). The test:

```ts
it('every reviewed write field is unchanged by the move to JSON', () => {
  expect(overlayFromDefs(settingsDefsFor('tinyg-en')!)).toEqual(golden.base);
});
it.each([450.05, 450.06])('the %s schema keys are unchanged', (fb) => {
  expect([...settingsSchemaFor('tinyg-en', fb).settings.keys()].sort()).toEqual(golden.keysByFb[String(fb)]);
});
it('the schemaKey strings are unchanged', () => { /* tinyg-en@a7489b79, tinyg-en@0e807169, tinyg-en@701c3876 */ });
```
- [ ] **Step 2: Run** `cd packages/schema && pnpm exec vitest run test/settingsGolden.test.ts`. Expected: FAIL (no `tinyg-450.json`).
- [ ] **Step 3: Author `tinyg-450.json`** with `families` for motors (`{m}` in 1..4) and axes (`{a}` in x..c, `{A}` upper case), `rows` copied from the `ROW` table in `tinygEn.ts`, `labelSrc` from spec §4.2's table. Labels and descriptions may improve (spec §5.5 wording); `write` fields may not change.
- [ ] **Step 4: Wire** `buildSettingsSchema` to the file. Keep its four existing throws.
- [ ] **Step 5: Run** `pnpm exec vitest run test/settingsGolden.test.ts test/overlay.test.ts test/settingsSchema.test.ts test/settingsWrite.test.ts test/writePlan.test.ts test/firmware45005.test.ts test/firmware45006.test.ts`. Expected: PASS, no test edited except imports.
- [ ] **Step 6: Commit** `git commit -m "Move the reviewed edge-next settings overlay into tinyg-450.json"`. **Safety review before merge:** reviewer confirms the golden was taken from the pre-change tree.

### Task 3: Describe every 450 setting, groups and inputs; coverage drift test

**Files:**
- Modify: `packages/schema/settings/tinyg-450.json` (definitions for the 83 read-group members without one: `baud coph ct ec ee ej ex fb fv gco gpa gpl hp hv id ja js jv qv rxm si spde spph sv tv`, `p1*`, `g54*`..`g59*`, `g28*`, `g30*`; readouts `in1`..`in8`, `spe spc sps cof com`; `groups` in spec §5.7 order; `inputs` per spec §5.4's table; `probeAllowed`)
- Modify: `packages/schema/src/settingsRead.ts` (group titles and explanations come from the file when it has them; `GROUP_TEXT` stays only as the fallback for dialects without a file)
- Test: `packages/schema/test/settingsCoverage.test.ts`

**Interfaces:**
- Consumes: `settingsDefsFor`, `settingsReadGroups`.
- Produces: `settingsDefsFor('tinyg-en').inputs` (8 entries, `xmin`..`amax`), `.groups`.

- [ ] **Step 1: Write the failing tests:**

```ts
it.each(['tinyg-en'])('%s: every read-group member has a definition', (d) => {
  const f = settingsDefsFor(d)!;
  const missing = settingsReadGroups(d).flatMap((g) => g.members).filter((k) => !f.tokens.has(k));
  expect(missing).toEqual([]);
});
it('every access write token is in the table with a value setter and not forbidden', () => { /* uses setterClass, isForbiddenKey */ });
it('forbidden tokens carry the forbidden rule reason', () => expect(settingsDefsFor('tinyg-en')!.tokens.get('ex')?.access).toBe('forbidden'));
it('reserved tokens are exactly den.json _reserved_hold_setting rows', () => { /* coph spph spde */ });
it('inputs map in order to sw.s[0..7]', () => expect(settingsDefsFor('tinyg-en')!.inputs.map((i) => [i.id, i.function, i.state, i.pin])).toEqual([['xmin','xsn','in1','J7.3'], ['xmax','xsx','in2','J7.4'], ['ymin','ysn','in3','J7.5'], ['ymax','ysx','in4','J7.6'], ['zmin','zsn','in5','J8.3'], ['zmax','zsx','in6','J8.4'], ['amin','asn','in7','J8.5'], ['amax','asx','in8','J8.6']]));
it('every src names a row of the vendored table commit', () => { /* same rule as overlay.test.ts line check */ });
it('in1 values are -1 Off, 0 Released, 1 Pressed', () => { /* labels pending BC-1 */ });
```
- [ ] **Step 2: Run** `cd packages/schema && pnpm exec vitest run test/settingsCoverage.test.ts`. Expected: FAIL listing the 83 tokens.
- [ ] **Step 3: Author the definitions.** `access: "read"` for `ct ja gco gpa gpl` and `p1*` (no reviewed write yet; `reason` "Not changed by Run yet."), `forbidden` with the rule reason for H61 keys, `readout` for live values, `reserved` for den.json stubs. Value labels from spec §4.2 table (`ex`, `rxm`, `jv` 0 silent to 5 verbose from EN json_parser.c:1103 `fmt_jv`, `ee`/`ec` off/on).
- [ ] **Step 4: Run** the coverage test plus `test/settingsRead.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Describe every edge-next setting and its inputs in tinyg-450.json"`.

### Task 4: Describe-only files for stock 449 and 440

**Files:**
- Create: `packages/schema/settings/tinyg-449.json` (dialect `tinyg-449-stock`, `fb` 449.01, `mode` readOnly, no `write`, citations at c5024186 from spec §4.2; probe contact note "Always normally open on this firmware." citing 449 switch.c:126-128; `probeAllowed` `["x","y","z"]` citing switch.c:258-280; no `prbp`, `coph`, `spph`, `spde`)
- Create: `packages/schema/settings/tinyg-440.json` (dialect `tinyg-440`, `mode` readOnly in the file even though the dialect is writable: no `write` objects until its own review; citations at d0418390)
- Modify: `packages/schema/src/settingsDefs/load.ts` (register both)
- Modify: `packages/schema/test/settingsCoverage.test.ts` (extend the `it.each` to all three dialects; add the agreement test)

- [ ] **Step 1: Write the failing tests:**

```ts
it.each(['tinyg-449-stock', 'tinyg-440', 'tinyg-en'])('%s: every read-group member has a definition', …);
it('shared tokens agree on value meanings unless marked differs', () => { /* 449 vs 450 over common keys */ });
it('449 has no write objects and no prbp', () => { const f = settingsDefsFor('tinyg-449-stock')!; expect([...f.tokens.values()].some((t) => t.write)).toBe(false); expect(f.tokens.has('prbp')).toBe(false); });
it('440 adds no writable key to the 440 schema', () => expect([...settingsSchemaFor('tinyg-440').settings.values()].filter((d) => d.overlay).length).toBe(0));
```
- [ ] **Step 2: Run** `cd packages/schema && pnpm exec vitest run test/settingsCoverage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Author both files** (copy the 450 describe fields; cite each `src` to the dialect's own commit; `differs` with citation where 449 differs).
- [ ] **Step 4: Run** the coverage, golden and `settingsSchema.test.ts` files. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add describe-only settings files for stock 449 and 440"`. **Safety review:** confirms nothing became writable.

### Task 5: The web app reads definitions; label tables deleted

**Files:**
- Modify: `apps/web/src/workspace/boardFacts.ts` (delete `PLAIN_LABEL`, `PLAIN_VALUES`, `RESERVED`, the `note` strings in `OUTPUT_FUNCTION`; `settingMeta` and `plainValue` read `settingsDefsFor(dialect, fb)`)
- Create: `apps/web/src/workspace/settings/defs.ts` (`defsFor(view: LiveView | null): SettingsFile | null`, `definitionOf(key: string, view: LiveView | null): SettingDefinition | null`)
- Delete: `packages/schema/src/overlays/tinygEn.ts` (update `overlay.test.ts` and other imports to `overlayFromDefs(settingsDefsFor('tinyg-en')!)`)
- Test: `apps/web/test/settingDefs.test.ts`, `tools/gates/test/no-setting-labels.test.ts`

**Interfaces:**
- Produces: `settingMeta(key, dialect, fb?)` returns `{ key, label, short, unit, description, values, access, reason, token }`; `plainValue(key, v, dialect, fb?)` returns the value label, or `"Unknown value (n)"` for an enumerated value outside `values`, or the number with unit.

- [ ] **Step 1: Write the failing tests:**

```ts
it('449: 1mi 2 reads "Half step (2)"', () => expect(plainValue('1mi', 2, 'tinyg-449-stock')).toBe('Half step (2)'));
it('449: xsn 4 reads "Probe"; gun 1 reads "Millimetres (G21)"', …);
it('449: 1mi 3 reads "Unknown value (3)"', …);
it('449: coph has no definition', () => expect(settingMeta('coph', 'tinyg-449-stock').access).toBeNull());
it('every read-group member of every dialect with a file has a label that is not its token', () => { /* loops settingsReadGroups */ });
it('a dialect without a file returns the token as label and null access', () => expect(settingMeta('xsn', 'g2core-edge').label).toBe('xsn'));
```
Gate test: fails when a `Record<string, string>` literal keyed by setting tokens appears in `apps/web/src/workspace/boardFacts.ts` or `apps/web/src/workspace/views/board/**` (match two or more `'<token>': '` entries whose keys are in the vendored tables).
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run test/settingDefs.test.ts` and `cd tools/gates && pnpm exec vitest run test/no-setting-labels.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and delete the tables.
- [ ] **Step 4: Run** both files plus `apps/web` `test/board-pins.test.ts test/board-draft.test.ts test/settingsWrite.test.ts` and `packages/schema` `test/overlay.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Read setting names and values from the settings files"`.

## Slice B: one editing model

### Task 6: `SettingControl`, read-only and inches gates

**Files:**
- Create: `apps/web/src/workspace/settings/SettingControl.ts` (segmented for an enum of at most five values whose labels total at most 48 characters; select otherwise; number field with unit; locked variants)
- Create: `apps/web/src/workspace/settings/editGate.ts` (`editBlocked` moved here and tightened; `ReadOnlyNotice` text builder)
- Modify: `apps/web/src/workspace/settings/SettingsUi.ts` (remove `SettingEditor` and `editBlocked`; re-export nothing)
- Modify: `apps/web/src/workspace/settings/pending.ts` (`settingsWriteBlocked` adds the inches reason)
- Test: `apps/web/test/settingControl.test.ts`, `apps/web/test/editGate.test.ts`

**Interfaces:**
- Produces:
  - `function SettingControl(p: { k: string; view: LiveView | null; locked?: boolean }): ComponentChild` with attributes `data-setting-control={k}`, `data-control-kind="segmented|select|number|locked|text"`, the pending row state via `data-pending="true"`; renders "was <board value words>" when pending.
  - `function editBlocked(view: LiveView | null): string | null` returning, in order: `'Connect a board to change its settings.'`, `SETTINGS_WRITES_UNAVAILABLE`, `'Run can't change settings on firmware <fb>.'` (READ_ONLY overlay, `classification.mode !== 'full'`, or the dialect file is `readOnly`), `'Wait for the settings read to finish.'`, else null.
  - `function readOnlyNotice(view: LiveView | null): { text: string; update: boolean } | null`

- [ ] **Step 1: Write the failing tests** (render with `apps/web/test/tree.ts`):

```ts
it('xsn renders five segments labelled from the data, the board value selected', …); // Off Homing Limit 'Homing and limit' Probe
it('1mi renders a select with Full step (1) … Eighth step (8) and no "Keep" option', …);
it('choosing the board value again clears the pending change', …);
it('a board value outside values shows "Unknown value (3)" and no segment selected', …);
it('locked renders every option with the current marked and no enabled input', …);
it('READ_ONLY board: editBlocked says "Run can\'t change settings on firmware 449.01."', …);
it('tinyg-449-stock dialect is blocked even if the overlay list is empty', …);
it('unit 0: settingsWriteBlocked says "Set the board to millimetres (G21) to change lengths."', …);
```
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run test/settingControl.test.ts test/editGate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The control writes only to `draftStore` via `setDraft`; it never calls a model action.
- [ ] **Step 4: Run** both files plus `test/settingsWrite.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add one setting control and block edits on read-only boards"`. **Safety review:** tightening only.

### Task 7: Sticky `PendingBar`, review panel, board change

**Files:**
- Create: `apps/web/src/workspace/settings/PendingBar.ts` (count, high-risk count, one-line consequence for one change, Discard, Review and apply…)
- Create: `apps/web/src/workspace/settings/ReviewPanel.ts` (today's tray table and `ApplyProgress`, moved from `SettingsUi.ts`; opens `ApplyConfirm`)
- Create: `apps/web/src/workspace/settings/boardChange.ts` (`discardOnBoardChange(prevId: string | null, nextId: string | null): boolean`)
- Modify: `apps/web/src/workspace/views/BoardView.ts` (bar at the bottom, notice above the tabs, per-tab pending badges from each definition's `tab`)
- Modify: `apps/web/src/styles/settings.css` (`.pending-bar { position: sticky; bottom: 0 }`)
- Test: `apps/web/test/pendingBar.test.ts`

- [ ] **Step 1: Write the failing tests:**

```ts
it('no bar without pending changes or a run in progress', …);
it('one change: shows its consequence; Review and apply opens the panel with the diff row', …);
it('Review and apply is disabled with the editBlocked or settingsWriteBlocked reason as its title', …);
it('apply calls model.actions.applySettings only after ApplyConfirm confirms', …);
it('a different board id discards pending changes and shows "Pending changes were for another board and were discarded."', …);
it('tab badges count pending keys per tab from the definitions', …);
```
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run test/pendingBar.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Delete `PendingTray` from `SettingsUi.ts`; keep the `data-action` names `apply-settings`, `revert-settings`, `discard-pending`, `remove-pending`, `clear-apply` so `settings-write.fake-serial.ts` keeps its selectors (update its tray locator to `[data-region="pending-changes"]` on the panel).
- [ ] **Step 4: Run** the test file, then `cd tools/e2e && RUN_E2E_FAKE_SERIAL=1 RUN_E2E_PORT=8795 pnpm exec playwright test --config playwright.fake-serial.config.ts specs/settings-write.fake-serial.ts` after `pnpm build:fake-serial`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Move pending changes to a sticky bar with a review panel"`.

## Slice C: the tabs, generated from the data

### Task 8: Inputs tab

**Files:**
- Create: `apps/web/src/workspace/views/board/inputsModel.ts` (pure)
- Rewrite: `apps/web/src/workspace/views/board/inputs.ts` (contact section, input rows, homing summary; layout per mockup `2026-11-18-board-config-inputs`)
- Test: `apps/web/test/inputsModel.test.ts`, `apps/web/test/inputsTab.test.ts`

**Interfaces:**
- Produces:
  - `interface InputRow { id: string; label: string; pin: string; functionKey: string; board: number | null; planned: number | null; pending: boolean; state: 'pressed' | 'released' | 'off' | null }`
  - `function inputRows(defs: SettingsFile, settings: Settings, drafts: Drafts, states?: Readonly<Record<string, number>>): readonly InputRow[]`
  - `function homingSummary(defs: SettingsFile, planned: Settings, axes: readonly string[]): readonly { axis: string; text: string }[]` (uses `homingAxis`)
  - `function inputConsequences(defs: SettingsFile, board: Settings, planned: Settings): readonly string[]`

- [ ] **Step 1: Write the failing tests** with the owner's 449 values (xsn 1, xsx 0, ysn 1, ysx 0, zsn 4, zsx 1, asn 1, asx 0):

```ts
expect(homingSummary(d449, s, ['x','y','z','a']).map((x) => x.text)).toEqual(['X homes towards min · J7.3', 'Y homes towards min · J7.5', 'Z homes towards max · J8.4', 'A homes towards min · J8.5']);
expect(inputConsequences(d450, { ...s, xsx: 2 }, { ...s, xsx: 0 })).toContain('X max has no limit. Only soft limits stop X at the far end.');
expect(inputConsequences(d450, s, { ...s, zsn: 1, zsx: 1 })).toContain("Z can't home on both ends. Choose one.");
expect(inputConsequences(d449, s, { ...s, asn: 4 })).toContain('A probe is allowed only on X, Y or Z on this firmware.');
expect(inputRows(d450, s, {}, { in6: 1, in2: -1 }).find((r) => r.id === 'zmax')?.state).toBe('pressed');
```
Tab test: 449 shows the probe line "Normally open. Fixed on this firmware." and no `prbp` control; 450 shows `prbp`; read-only shows locked controls and no `data-pending`.
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run test/inputsModel.test.ts test/inputsTab.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The Edit values toggle and `EditToggle` usage go; rows use `SettingControl`.
- [ ] **Step 4: Run** both files. Expected: PASS. Walkthrough screenshots.
- [ ] **Step 5: Commit** `git commit -m "Build the Inputs tab from the settings file"`.

### Task 9: Test switches (owner Q3; safety review; BC-1 to BC-4 first)

Do not start until the owner answers Q3 yes and the TG Firmware session reports BC-1 to BC-4.

**Files:**
- Create: `apps/web/src/live/switchTest.ts` (window side: start/stop, 250 ms cadence, two-minute limit)
- Modify: the worker's read path only through the existing allowlisted read request (no new intent; one outstanding line, as every read)
- Modify: `apps/web/src/workspace/views/board/inputs.ts` (button, header sentence, Now column)
- Test: `apps/web/test/switchTest.test.ts`

**Interfaces:**
- Produces: `function createSwitchTest(deps: { read: (tokens: readonly string[]) => Promise<unknown>; idle: () => boolean; now: () => number; setTimer: …; clearTimer: … }): { start(): void; stop(): void; states: ReadonlySignal<Readonly<Record<string, number>>>; running: ReadonlySignal<boolean> }`

- [ ] **Step 1: Write the failing tests** with fake timers:

```ts
it('reads ["in"] every 250 ms while idle', …);
it('never has two reads outstanding', …);
it('stops within one poll when idle() turns false', …);  // Review Focus 5
it('stops after 120 s', …);
it('stops when the Inputs tab unmounts', …);
it('the header says "Reads each input 4 times a second while on. A switch set to Limit stops the board when pressed."', …);
```
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run test/switchTest.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add Test switches to the Inputs tab"`.

### Task 10: Motors cards

**Files:**
- Rewrite: `apps/web/src/workspace/views/board/motors.ts` (one card per motor, two columns, rows from the `motor-{m}` group, derived steps per unit board → new)
- Delete: `apps/web/src/workspace/views/board/motorDraft.ts` and the `MotorDraft` export from `BoardView.ts` (check `graft_trace_calls` for other users first; `board-draft.test.ts` moves to the card)
- Test: `apps/web/test/motorsTab.test.ts`

- [ ] **Step 1: Write the failing tests:** owner 154 values (1ma 0, 1sa 1.8, 1tr 1.25, 1mi 2, 1po 1, 1pm 2) read "X axis", "1.8° per step", "1.25 mm", "Half step (2)", "Reversed", "On during a job, off after the idle time", steps per mm "320"; a pending `2mi` 8 shows "320 → 1 280"; a read-only board renders no enabled control.
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run test/motorsTab.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** plus `test/board-draft.test.ts`. Expected: PASS. Walkthrough screenshots.
- [ ] **Step 5: Commit** `git commit -m "Show motors as cards built from the settings file"`.

### Task 11: Axes, Spindle and coolant, Communications, stale copy

**Files:**
- Modify: `apps/web/src/workspace/views/board/axes.ts` (cards per machine axis, OD-13; switch modes removed, they live on Inputs)
- Modify: `apps/web/src/workspace/views/board/outputs.ts` (polarity rows from data; absent tokens read "No setting on this firmware"; the coolant row shows the machine record's wired-to value from the separate builder's field, read only here)
- Modify: `apps/web/src/workspace/views/board/comms.ts` (values from data; one group sentence)
- Modify: `apps/web/src/workspace/views/board/identity.ts:47` (remove "Phase 1 connects every board read-only…")
- Modify: `apps/web/src/machine-ui/AxisModes.ts:85` (remove "This release never moves the machine.")
- Test: `apps/web/test/boardTabs.test.ts`

- [ ] **Step 1: Write the failing tests:** 449 J6.6 polarity reads "No setting on this firmware", 450 reads "Reserved on this firmware"; neither stale sentence appears anywhere in the rendered Board view; Axes shows X, Y, Z (and A only when the machine has it); a dialect with no file renders values raw and no control (Review Focus 2).
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run test/boardTabs.test.ts test/axisModes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Delete `EditToggle` and `cell` from `views/board/shared.ts` when no tab uses them.
- [ ] **Step 4: Run.** Expected: PASS. Walkthrough screenshots.
- [ ] **Step 5: Commit** `git commit -m "Build Axes, Spindle and coolant and Communications from the settings file"`.

### Task 12: All settings at both levels

**Files:**
- Create: `apps/web/src/workspace/settings/allSettingsModel.ts` (pure: rows grouped by the file's `groups`, then "No definition yet"; search over label, value words and token; chips; only pending)
- Rewrite: `SettingsTable` into `apps/web/src/workspace/settings/AllSettings.ts`; delete it from `SettingsUi.ts`
- Modify: `apps/web/src/workspace/views/board/settings.ts` (always `AllSettings`; `GuidedSettings` stays only in `MachinesView.ts`)
- Test: `apps/web/test/allSettings.test.ts`

**Interfaces:**
- Produces: `function allSettingsRows(defs: SettingsFile | null, settings: Settings, drafts: Drafts, q: { text: string; group: string | null; pendingOnly: boolean }): readonly { group: GroupDefinition; rows: readonly string[] }[]`

- [ ] **Step 1: Write the failing tests:** Simple and Advanced both list every reported key (count equals `Object.keys(settings).length`); Simple has no token column; a reported key with no definition lands in "No definition yet" last; search "half" finds `1mi` with value 2; Communications header carries the H61 sentence once and its rows have no lock tag; the footer says "Live readouts (input states, homed axes, positions) are on Inputs, Axes and the Job view."
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run test/allSettings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** One-line rows 38 px; the "i" toggles the description under the row.
- [ ] **Step 4: Run.** Expected: PASS. Walkthrough screenshots.
- [ ] **Step 5: Commit** `git commit -m "Show every reported setting in All settings at both levels"`.

## Slice D: Backups

### Task 13: One Backups section

**Files:**
- Create: `apps/web/src/workspace/views/board/backups.ts` (the settings part of `BackupsHub`, moved out of `FirmwareViews.ts`)
- Modify: `apps/web/src/workspace/views/FirmwareViews.ts` (keeps only the firmware image part)
- Modify: `apps/web/src/live/firmwareHub.ts` (`record` accepts `'before-update'`; backup list rows expose `settingsCount`)
- Delete: `RestorePanel` and `stageRestore` from `SettingsUi.ts` (import goes through `fw.importSettings`, which lists the file with trigger `import`)
- Test: `apps/web/test/backupsSection.test.ts`, extend `apps/web/test/firmwareHub.test.ts`

- [ ] **Step 1: Write the failing tests:** empty state text "No backups of this board yet." with a primary `data-action="backup"`; with rows, the table columns are Taken, Why, Firmware, Board, Settings and the Why words are "Manual", "Before an apply", "Before a firmware update", "Added from a file"; a backup from another board shows the "another board" tag; Compare renders the diff rows with value words from the definitions; Restore stages pending changes and switches to the tab of the first change; Restore is absent on a read-only board; there is exactly one file input (`data-action="backup-import"`), labelled "Add a backup file…".
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run test/backupsSection.test.ts test/firmwareHub.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Walkthrough screenshots.
- [ ] **Step 5: Commit** `git commit -m "Rebuild Backups as one section with a list and one file action"`.

### Task 14: Regression spec in the built app

**Files:**
- Create: `tools/e2e/specs/board-config.fake-serial.ts`

- [ ] **Step 1: Write the spec** with two tests: (a) read-only board (`next = { build: { fb: 449.01, fv: 0.97, hv: 8, layout: 10002 } }`): the notice text, no enabled `[data-setting-control] input, select, button`, no pending bar, no `backup-restore`; (b) approved board: set X min to "Homing and limit" on Inputs, the bar shows "1 change pending" and "1 high risk", Review and apply opens C5 with the `xsn` consequence, confirm, the backup downloads, `[data-apply-step="xsn"]` reaches `verified`, Revert restores the EEPROM value (read through `__RUN_FAKE_SERIAL__` as `settings-write.fake-serial.ts` does).
- [ ] **Step 2: Run** `pnpm build:fake-serial`, then `cd tools/e2e && RUN_E2E_FAKE_SERIAL=1 RUN_E2E_PORT=8795 pnpm exec playwright test --config playwright.fake-serial.config.ts specs/board-config.fake-serial.ts`. Expected: PASS.
- [ ] **Step 3: Commit** `git commit -m "Add a fake-serial regression test for Board settings"`.

## Later, not in this plan

- Account copies of settings backups (owner Q5): after account storage ships, a separate slice.
- `tinyg-440` writes: needs its own reviewed `write` objects and bench evidence.
- `g2core-101.json`: Phase 7, with the vendored g2core table; the `inputs` entries carry `di{n}mo`, `di{n}ac`, `di{n}fn`.

## Safety review summary

| Task | What the reviewer checks |
|---|---|
| 2 | Golden taken from the pre-change tree; no `write` field changed; CODEOWNERS covers the new paths |
| 4 | No `write` object in 449 or 440 files; no key became writable |
| 6 | `editBlocked` only tightens; inches reason matches the session's refusal |
| 9 | One outstanding read (H57); stops on motion and alarm; the limit sentence shown; whether a hazard entry is needed |
| 13 | Restore still stages through `restoreChanges` and the apply path; identity and forbidden keys skipped |

Flagged SAFETY text proposals (owner decides; spec §7): H58 mitigation 4 names Test switches; §4.6 step 2 account backups.

## Bench checks for the TG Firmware session

BC-1 to BC-7 as in spec §8. BC-1 to BC-4 gate Task 9. BC-5 confirms `probeAllowed` in the 450 file (Task 3). BC-6 is the end-to-end apply after Task 14. BC-7 confirms the power-mode wording (Task 3).

## Owner questions (spec §9, recommendations)

1. Drop the Edit values toggle; controls inline wherever Run may write. **Recommend yes.** Blocks Tasks 6, 8, 10, 11.
2. All settings shows every setting at Simple. **Recommend yes.** Blocks Task 12.
3. Test switches. **Recommend yes**, after safety review and BC-1 to BC-4. Blocks Task 9.
4. One "Add a backup file…" action. **Recommend yes.** Blocks Task 13.
5. Settings backups also in the account. **Recommend yes, later.** Not in this plan.
6. Describe-only definitions for stock 449. **Recommend yes.** Blocks Task 4.
7. Sticky Apply bar at the bottom. **Recommend yes.** Blocks Task 7.
8. Tokens at Advanced only. **Recommend yes.** Affects Tasks 6 and 12.

Slice A (Tasks 1 to 5) needs no owner answer except Q6 and can start now.
