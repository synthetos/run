# Maker review

Branch: `maker-review` (from main 85915991). Written for the owner to read in the morning.

I reviewed the site as a hobby maker would: first run, Job page, Library, Board, Projects, Analyze, public pages and keyboard use. Fixers made the safe changes. Safety-sensitive and product items are listed below and were not touched.

Screenshots are in `docs/design/screenshots/maker-review/`. Names are `MR-<id>-before|after-light|dark.png`. Some fixes have only an after shot.

## What looks good (keep it)

- Sign-in front door: one dialog, one button, one line for new users.
- Setup wizard: step list with ticks, one primary button per step, "Skip for now" everywhere.
- Job page: five-step bar with a one-line summary under each step, and Back / Next in the same corner.
- Machine strip: Pause (amber) and Stop job (red) are large, labelled with words and never move.
- Run step checklist: short label, short summary, one action per row. Start stays dim until it is satisfied.
- Start confirmation puts "Keep a hand on the E-stop" first.
- Tool catalog: "Add to my tools" opens the editor pre-filled. Search understands "1/4 upcut 2 flute".
- Materials: safety level and coolant shown as icon plus word. "Do not machine" for PVC.
- Placeholder numbers are labelled honestly. Analyze says "Not advice yet."
- Read-only 449 board: one amber banner, every option still visible.
- Board tabs: maker words (step angle, travel per turn, steps per mm), one motor per sub-tab, no page scroll.
- Changing a setting shows "was 800 mm/min", a pending bar and a review table before Apply.
- Keyboard: global focus ring, named jog pad, tooltips on focus, sound headings and landmarks, reduced motion honoured.
- Light and dark both render every screen cleanly. I re-checked 17 screens in both themes at 1280x800 tonight: no page scroll anywhere.

## What was fixed tonight

Commits are on `maker-review`. Hashes are short.

| Fix | What changed | Screenshots | Commit |
|---|---|---|---|
| MR-13 | Viewer progress chip and light chip now stack. They no longer overlap. | none | 3a9588c3 |
| MR-16 | Position columns are labelled "Work" and "Machine" at Simple. | none | 3a9588c3 |
| MR-17 | Jog pad: diagonal keys readable, selected step is a solid blue. | none | 3a9588c3 |
| MR-18 | Disabled primary buttons (Home, wizard Next) now grey, not blue-washed. | none | 3a9588c3 |
| MR-24 | Tool catalog has a "For" column (hard plastic, aluminum). | MR-24-before/after | 22b83346 |
| MR-25 | Catalog tools get real names ("Up-cut spiral"). Inch users see `1/4" end mill`. Cut lengths show 22.2 mm. | MR-24-after | 22b83346 |
| MR-26 | Catalog is paged ("30 tools", pager), no clipped last row. | MR-24-after, walk-library-catalog-light | 22b83346 |
| MR-29 | Search matches "up cut", "up-cut", "O-flute", "aluminium". Filters come from the data. | MR-29-before/after | 22b83346 |
| MR-30 | My tools empty states: "No tools yet." plus an Add button. Blank Notes cell. | MR-30-before/after | 22b83346 |
| MR-39 | Firmware release list shows every row. The installed 450.02 row was cut off by 32 px. A test now guards it. | MR-39-after, walk-board-firmware-dark | 77494da1 |
| MR-41 | Homing tab badge counts only pending changes. One row per axis. | MR-41-after | 77cd9a11 |
| MR-42 | Plainer Board wording. No travel limit shown when ends are equal. Platform and version at Advanced only. | MR-42-after | 7f4a0a94 |
| MR-46, MR-47, MR-05 | Plain view names and shorter help copy. Simpler Welcome step with a "Have ready" list. | none | 7798ca8e |
| MR-35 | Analyze names the missing planner settings and links to Board settings. | none | ae0ca1ce |
| MR-36 | Analyze is two columns. One compact "Nothing to fix." row. No box round a single operation. | MR-36-*-before/after, walk-analyze-light | 2ca2383e |
| MR-14 | Hint under tool Number. Stickout marked optional. | MR-14-before/after | d2d87b88 |
| MR-37 | Coolant reads Required / Recommended / Not needed / Avoid. File hash only at Advanced. | MR-37-*-before/after | 2511b23c |
| MR-45 | Preferences is two columns, with a "Your data" panel. Hint notes removed. | MR-45-before/after, walk-settings-dark | 053c31a9 |
| MR-53 | Wiring page: firmware labels from the shared helper, no v6/v7 note, start hint. | MR-53-before/after | 99b07dd9 |
| MR-55 | Machines view left-aligned. Stray "?" removed. | MR-55-*-before/after | f5b97a47 |
| MR-56 | One shared zebra stripe on wizard topics and update lists. | MR-56-update-after | 3230d3b8 |
| MR-34, MR-51 | Short fields sized to content. Focus outlines kept. Larger hit areas. 12px body labels. | MR-34-library-after | 9338a3bb |

Tonight's walkthrough found no regression, so there is no extra fix commit.

Follow-up (browser-test fixes):
- MR-13: the viewer chips sit bottom-right again, stacked, so the file prompt card is above them.
- MR-14: tool-editor number fields were full width after MR-34 (text inputs matched the full-row rule). Now sized to content, so every tool tab fits 1280x720. Hints kept. MR-14-after screenshots retaken.
- MR-34: cutting-row form fields sized to content (Apply is back inside the pane). The dead three-column rule is removed.
- Wizard catalog spec (147) now checks the full count, a pager and at least 5 rows with no inner scroll, and the catalog name from MR-25 ("Up-cut spiral").

Partly done (not finished):
- MR-14: field reorder skipped (Type, Diameter, Flutes, Number). Tool tests focus the Number field.
- MR-26: Materials list and Machine catalogue grid still scroll inside their own panels.
- MR-25: wizard, project chips and Analyze still show the mm fallback for unnamed tools in inch mode.
- MR-51: `.notes-pill` and viewer chips left at 11.5 px to avoid wrapping.
- MR-34: the old three-column cutting-row form rule is now dead CSS. I did not check that form by eye.

Things I noticed while checking:
- `tool-library.e2e.ts` was edited but cannot be run by the agents. Run it in the main gate.
- Several fixes shipped without before/after shots (MR-13, 16, 17, 18, 35, 41 before, 42 before, 46, 47, 05). The walkthrough covers their screens by eye only.
- `src/workspace/controlBlock.ts:84` has the old flow-control wording. It is safety-adjacent and a test pins it. Left alone.

## What still needs you

Ranked by maker impact. Items marked SAFETY are report-only.

1. **MR-02 SAFETY: the Safety page says this build cannot connect to a machine.** Evidence: `SafetyPage.ts:59-60`, pinned by `prerender.test.ts:128`. It is false and it contradicts section 1 on the same page. Next step: delete the paragraph and update that test. Needs the safety owner.
2. **MR-01: Privacy page says there is no sign-in and no cloud storage.** Evidence: `PrivacyPage.ts:13,29`, "placeholder" chip. The front door says Run keeps your data in your account. Next step: replace with true short bullets, add a Privacy link at the front door. You confirm what is stored.
3. **MR-23: new accounts start with six invented tools.** Evidence: `libraryRecords.ts:42`, `librarySeed.ts`. A CAM file calling T2 silently matches a fake tool, so the "not in your tool table" prompt never shows. Conflicts with "accounts start from scratch". Next step: start accounts empty, keep seeds for bench only, add an optional "Add sample tools" button. Touches sync and tests.
4. **MR-19: Job steps Stock and Place scroll inside a 170 px left panel.** Evidence: `walk-job-place-light.png` still shows the X/Y inputs cut off. A maker can press Next without setting material or offset. Next step: pick one layout. Move the File block to a header row, shrink the corner picker, or split Stock into two sub-tabs.
5. **MR-10: Run checklist wording is terse** ("Can't compare.", "Review.", "Line 7 goes past Z."). Evidence: `readyModel.ts:114-151`. Next step: wording only, as in the refined fix. Keep the gating.
6. **MR-03 and MR-04: the front door does not say Run needs Chrome or Edge, USB and a GitHub account.** Evidence: `SignInGate.ts`, `portChooser.ts:21`. Copy is owner-approved, so you decide. Next step: add one line, "Run controls TinyG CNC controllers over USB. Use desktop Chrome or Edge." and "You need a free GitHub account."
7. **MR-09: disconnected Job page.** The disabled-primary fix greys Home. The "Connect first" cue is still missing. Gating was checked and is sound. Next step: one line on step 1 while not connected.
8. **MR-28: machine templates ignore frame size, and machines cannot be deleted.** Evidence: `machineDrawings.ts:463`, no delete function. Next step: number repeat copies ("My X-Carve 2"), open Edit after copy, add Delete with a confirm. Per-size travel needs your sourcing.
9. **MR-27: spindle and frame answers are asked in Analyze and kept only in this browser.** Evidence: `advisorState.ts:10`, not in `LIBRARY_NAMES`. Next step: add a "Spindle and frame" group to the machine record. Needs a schema decision.
10. **MR-06 SAFETY: firmware step does not say if updating is needed.** Evidence: wizard step 3 shot. Next step: make Update secondary when the state is "available". Add owner-approved facts and flash-time wording on the Firmware page, not in the wizard.
11. **MR-20: Live job and G-code dock too small while running.** Evidence: `job-layout.css` fixed dock heights. Next step: one token that grows the dock while running or held.
12. **MR-50 SAFETY: no focus trap in confirms, no skip link, spindle and strip state not spoken, disabled controls give no keyboard reason.** Next step: skip link is safe to add. The trap needs a design that keeps Pause and Stop reachable.
13. **MR-52 SAFETY: the Update page has no site frame** (no header, footer or way back). Next step: add header and footer. Decide whether the warning bar belongs there.
14. **MR-43 SAFETY: Firmware tab shows "Bench and staging", has a dead end for 449 owners without a flasher, repeats the update warning, and hides the changelog on touch.** Still visible in `walk-board-firmware-dark.png`.
15. **MR-40 SAFETY (partly): Board wording.** Coolant pointer has no link, review panel uses long names, validation messages carry codes. Next step: add the link and short names. Leave `validate.ts` and the C5 text.
16. **MR-08: bed fields say "Owner-counted" and "Bed top, machine Z".** Next step: copy only. Do not say "leave 0 if unsure": a wrong bed top weakens the cut-into-bed warning.
17. **MR-31: Projects.** File remove has no confirm. Detail page scrolls inside itself. Share text is wrong for signed-in users. Next step: inline confirm first.
18. **MR-32: storage filler.** "Kept in this browser" contradicts the account line. "Saved to your account" shows on every view. Next step: show the sync line only when something is wrong.
19. **MR-33: "Placeholder" tag repeats on every material value.** Next step: one legend plus a dashed underline. Sourcing real values is yours.
20. **MR-48: naming.** "Your machine" tab, catalog/catalogue, aluminium/aluminum, "Stock & workholding". Next step: pick US spelling and the step names.
21. **MR-21: spindle buttons show no active state.** The link "Set what is wired" is vague. Display only, but it sits in the spindle path.

Eleven findings were refuted in verification and are not listed.

## What was not covered, and why

- Real machine behaviour. No board, no cutting, no firmware flashing. The TG Firmware session owns that.
- Signed-in screens. The fake-serial build has no sign-in, so Preferences Account and Setup panels were only seen signed out.
- Phone and 1600 px widths, except MR-55 and the earlier layout specs.
- Dialogs: Start confirmation, tool modal and the pending-changes review were not re-captured tonight.
- The wizard was not re-walked after MR-05 (Welcome step).
- Full test gates. Agents ran single files only. Run the main gate once before merging, including `tool-library.e2e.ts`.
