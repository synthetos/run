# Analyze: explain this job before asking the user to improve it

**Status (2026-11-09, OD-27).** The design is the plan for Analyze. Slice 1 is approved and built. The planner model of slice 2 is pinned to the firmware build it models (owner: "we need to make sure the tg motion profiles doesn't change or this preview will too"): a new approved firmware build means checking the model again before its estimates keep their label.

**Slice 1 as built.**
- `packages/gcode/src/events.ts`: the interpreter records an analytic event tape beside its drawing (packed typed arrays; arc lengths from the arc model, never the tessellation; file line, sent line and event kept apart; inserted and split lines flagged; rotary moves flagged and never measured in mm).
- `packages/advisor/src/analysis/` (`types`, `moves`, `density`, `operations`, `report`): the motion report from the tape. Each shown value carries its evidence. Feed time only for known feeds; rapids timed only from known rapid speeds; unknown stays unknown, never zero.
- `apps/web/src/gcode-worker/headings.ts` and the pipeline: the report is computed in the G-code worker and travels inside the preview result (lite mode too), so it can never belong to another file. advisorModel no longer reads the file's modes itself.
- `apps/web/src/workspace/analysisInputs.ts`: board values are "Board settings", a reading saved in this browser is "Last read …", the machine profile comes last. Read only; pending drafts are never used.
- Analyze: Summary, Where it slows (each region opens Job at its first line), Cutting advice (one card per operation with its regimes; one question at a time). Advanced adds the motion settings with sources, every region, the line-density histogram, speed comparisons and the AI demonstration.
- Time is always "at programmed speeds, acceleration not included". No new serial commands, no file changes, no live tuning, no ETA.

The proposal follows as written, apart from this status.


Design proposal, 2026-11-09. Read against run c3ce4fd, including gcode types/interpreter pipeline, advisor achievable/envelope/tests, advisorModel/advisorState, AnalyzeView, the job streamer and MACHINING_ASSISTANT §§5–7/appendix. I also read the planner through `git show edge-next` at TinyG 9928f545; that is a research reference, not an assertion about the connected board's build. No code changes, tests or hardware runs in this review.

## Recommendation

Build one **job analysis report with three independent parts: motion, delivery, and cutting advice**. Share one interpretation of the actual program, but do not make one part depend on completing another's questionnaire. A user should open a file and immediately see what it does, where it is dense, its programmed motion time, and what information would improve the estimate. Tool/material data unlock cutting advice; they must not unlock basic motion analysis.

The product promise should be “Understand where this job spends time, and compare useful changes,” not “We know exactly how long your cut will take.” A trustworthy model that explains its limits beats a precise-looking countdown.

### What the current implementation explains about the walkthrough

- `advisorModel.ts:101–160` requires a complete cutting machine profile, material, tool, operation, depth, stepover and coolant before computing achievable feed. Motion prediction does not need most of these. `advisorState.ts` supplies profile/manual fields, not a versioned board-settings snapshot.
- `advisorModel.ts:66` groups by operation/tool/feed/rpm, while the UI labels rows with the operation name. A plunge and a lateral cut can consequently look like duplicate operations. Present one operation with subordinate feed regimes, not two indistinguishable operation cards.
- The same mapper breaks paths at feed changes and non-cutting lines; `achievable.ts` starts and ends each supplied path at rest. A reporting group boundary is not necessarily a physical stop. Timing must run over the chronological program, independently of presentation grouping.
- Geometry-based estimates stop above 10,000 vertices (`advisorModel.ts:33`), and the display vertices are Float32, with arc coarsening possible. Neither the rendering cap nor the rendering tessellation should determine timing accuracy.
- The current achievable model explicitly excludes axis limits, finite look-ahead and supply. Keep it as a named approximate model until replaced; do not relabel it a TinyG simulation.

## 1. Core model and code homes

Use an **ordered event tape**, not just a list of plotted points. Preserve original arcs and all execution-relevant events before rendering. A file line can generate several transmitted lines; a transmitted arc can generate many planner blocks; a command can consume a queue entry without adding visible distance. Keep those three identities separate.

Suggested public shapes (illustrative, not a new source of motion commands):

```ts
type Evidence<T> = {
  value: T | null;
  source: 'board' | 'saved-board' | 'profile' | 'user' | 'assumption';
  revision: string;
  units: string;
  observedAt?: number;
};
type AnalysisKey = {
  fileHash: string; preparedProgramHash: string | null;
  jobRevision: number; settingsHash: string; startStateHash: string;
  dialect: string; firmwareIdentity: string; modelVersion: string;
};
type ProgramEvent = {
  id: number; sourceLine: number; sentLine: number | null;
  operationId: string; modalStateId: number;
  kind: 'line' | 'arc' | 'dwell' | 'command' | 'barrier' | 'tool-change';
  // Float64 analytic geometry, native axis units, F/S/tool state,
  // encoded byte length, origin of inserted/split commands, boundary semantics.
};
type MotionSnapshot = {
  // Evidence per axis: mode, vm/fr/jm, junction parameters; native unit conversion;
  // planner capacity, arc/minimum-block rules, motor/step limits where applicable;
  // settings belong to THIS board/build, not an accidentally selected other profile.
};
type AnalysisReport = {
  key: AnalysisKey;
  coverage: { supportedEvents: number; totalEvents: number; reasons: string[] };
  time: { programmedSeconds: number | null; motionEstimate: number | null;
          scenarioRange: [number, number] | null; manualStops: number };
  // Regions mapped to source lines, operations, independent findings and assumptions.
};
```

Each metric has its own availability/evidence; a partially modelled file must never masquerade as a fully timed file. Retain a chronological event stream even if the UI groups disjoint spans under one CAM operation. Grouping labels from comments are descriptive only; they do not override dialect interpretation or generate stops. Use original/sent-line maps for breakpoints, reports, split moves and tool changes.

Suggested homes:

- `packages/gcode/src/events.ts`: extend the existing interpreter to emit analytic events alongside its rendering output. Reuse the existing dialect-aware parser, tool and frame semantics; retire the independent modal reconstruction in `advisorFile`. Do not build a third G-code interpreter.
- `packages/advisor/src/analysis/{types,motion,density,supply,report}.ts`: pure report orchestration and per-block models; a `models/tinyg-en.ts` adapter pinned to documented firmware behavior, with a clearly named generic fallback. No machine, DOM, network or transport imports. Additive work under advisor avoids a new package boundary initially.
- `apps/web/src/workspace/analysisInputs.ts`: maps a read-only session snapshot and the selected job/profile into plain inputs. Board readings win for that board's actual settings; profile values and saved readings remain labelled. Pending settings drafts are explicit what-if scenarios, never mistaken for applied values.
- Extend the existing `gcode-worker` pipeline for event generation. Run expensive prediction in a separate analysis worker if necessary, never in the machine worker. Use transferable packed arrays and cancellation; do not copy millions of JS point objects into signals. Lite preview must still support aggregate analysis without a rendered scene.
- `AnalyzeView.ts`, `advisorState.ts`, `advisorModel.ts`: thin selection/presentation adapters. Reuse the existing scene's region overlays rather than adding another 3D renderer.

An estimate made from the offline preview is provisional. Once preparation has produced the live sanitised stream, bind the report to its hash, settings/start-state revisions, units, offsets and active optional stops. A later file/setup/settings change invalidates the matching result. An old worker response must never replace a newer report. This is report freshness, not an additional Start permission or machine write path.

### How faithful should planning be?

Ultimately model the **firmware's planning behavior**, not a generic S-curve with TinyG labels: direction-dependent axis limits, junction rules, jerk conventions, minimum-block behavior, arc expansion, finite planner capacity and replanning as blocks arrive. Firmware-specific quirks belong in the versioned adapter, not the UI. An XYZ move's scalar feed ceiling depends on its direction; do not take the smallest axis maximum regardless of direction. Rotary/radius modes and inverse-time feed need separate support; until then identify those intervals as unsupported, never add degrees to displayed millimetres.

Do not try to duplicate interrupt/step generation in the browser first. A bounded discrete-event planner model is enough once calibrated against independent evidence. Use double precision for geometry; explicitly reproduce firmware float behavior only where it changes decisions. Retain the sketch as an estimate until the faithful model earns its label. Do not invent an acceleration parameter from jerk or copy a GRBL junction formula solely because the setting has a familiar name.

Validation has three layers: hand-solvable cases; differential fixtures from the pinned firmware planner (a native harness if the firmware team can provide one); and captures from the actual supported board/build. A second JS model copied from our predictor is not independent validation. The fixture matrix should include long straight moves, reversals, diagonals with unequal axis limits, tiny collinear moves, corner chains, arcs/helices, G20/G21, exact-stop mode, F changes, repeated S/coolant commands, queue depths and intentional input gaps. Verify motor step-rate restrictions if the selected build enforces them; current edge-next `_calc_move_times` includes a motor-time constraint as well as axis limits.

Have the firmware session collect repeated dry-run captures and, for selected tests, step-pulse timestamps or instrumented planner entry/cruise/exit speeds. Compare execution duration and regional velocity, not only serial receive timestamps. Report bias and tail error by fixture class on held-out files. A proposed readiness target is median duration error under 10% and 90th-percentile error under 20% on the declared supported corpus; these are proposed product targets, not results. Difficult classes retain a wider empirical interval or an incomplete label. Never calibrate away a systematic semantic mismatch.

## 2. Delivery is a coupled model, not a baud-rate badge

Simulate four stages: host scheduling/write completion, serial transmission, firmware receive/dispatch with acknowledgements, and planner execution. Distinguish line slots (`f[2]`) from planner slots (`qr`). Model the actual `pumpJob` policy: it reserves two line slots and subtracts owed answers; it can have more than one job line owed, and a control request can temporarily stop job pumping. Do not assume either an unlimited sender or strict one-request round trips just from the phrase “line mode.”

Use the exact prepared bytes, including numbering and terminators, plus control traffic and expected response/push sizes. At 115200 with 8N1, the directional ceiling is 11,520 bytes/s: a 60-byte transmitted line occupies about 5.2 ms before scheduling/dispatch costs. Confirm framing in the transport. UART directions are independent: do not blindly add transmit and receive bytes as a half-duplex link. Acknowledgement dependence and board CPU work still couple them. For a fixed W-line window, W/ack-latency is an additional simplified ceiling, not an achieved throughput promise.

Compute rolling demand over time and distance, not just average lines/s. One arc line may keep the planner busy for a long time; tiny line segments can exhaust it. Simulate prefill, bursts, control polls, telemetry load, barriers, finite capacity and tail drain. Supply changes future look-ahead and thus motion speed, so ultimately run planning and delivery on the same event clock. Do not add an independently calculated starvation penalty to a slowdown already represented by the planner.

Before measurement, show optimistic/nominal/stressed delivery scenarios with the assumed latency and jitter. After normal jobs, use local observed distributions from write-completion/reply records, with sample count and browser/link context. Do not send a benchmark program automatically. Neither a successful Web Serial write nor a reply means the move executed.

UI wording: “Dense section: may pause for more instructions” and “At this feed this section needs about X lines/s; this connection previously delivered Y–Z.” Link to the path and “CAM: allow longer moves where the shape permits.” High free `qr` alone does not establish host starvation. Future `fg`/`fs v2` “input pending” and “no input” are observations at the board, not proof of a slow cable, host or CPU. Parse them only for a validated capability/version. Keep deliberate tool-change/breakpoint pauses out of supply-gap analysis.

## 3. First screen: answer three questions

**How long? Where does it slow? What is worth changing?**

Simple should open on an estimate card, one shared toolpath colored by predicted speed, and at most three ranked findings. Example copy, using illustrative numbers: “About 18–23 min of machine time · plus 1 tool change.” Before a calibrated model exists: “12 min at programmed speeds · acceleration and delivery not included.” Never call that latter number a guaranteed minimum unless every contributing behavior and mode justifies it. Unknown manual waits mean no finite total completion-time upper bound.

Use separate tabs/layers for speed, short moves, delivery pressure and commands. Hover/click links a region to its original lines and gives a plain reason. The time summary uses mutually exclusive activities (feed moves, rapids, dwell, command execution, observed supply waiting). Slowdown reasons are overlapping tags, not a pie chart: fs cause counters can exceed cutting time in sum. “Time saved if…” is a modelled counterfactual; rank independent changes but do not add their savings together.

One CAM operation card contains Tool, cut/plunge regimes and reasons. Do not duplicate an operation just because its feed changes. A “cut move” means feed motion, not proven material engagement. Geometry alone cannot establish depth of engagement, stepover, chipload safety or a collision-free setup.

Motion inputs are read from the board automatically through the existing settings snapshot; no “Junction deviation” questionnaire in Simple. Disconnected: use a saved snapshot labelled “Last read …”, or an explicit profile scenario. With neither, still show geometry, programmed feeds, density, dwells and manual stops. Ask “Connect your machine to improve the time estimate,” not twenty questions. Do not use arbitrary motion defaults as if measured.

Cutting advice appears independently: “Choose material to check cutting conditions,” then the next genuinely necessary question. Known profile geometry and tool records can prefill values with provenance. Placeholder library data can illustrate the calculation but never produces a green safe/within-range claim. Do not guess engagement from stock bounds. Move conservative/balanced/aggressive comparisons into operation details; hide the all-Unavailable table. Put the canned AI picker in Advanced, labelled demonstration; it adds no value as the first control.

Advanced exposes per-axis settings and sources, model/build, line/byte and block density, entry/peak/exit speed, look-ahead scenario, separate causal tags, estimated versus observed curves, and exportable diagnostic data. It adds detail, not another truth or another safety policy.

## 4. Cleaning: useful, but a later explicit output

Offer “Create a smoother copy,” never automatic cleanup or stream rewriting. The original remains immutable. Each copy records its source hash, transformation/version, tolerance and changed line ranges. Sanitise and re-analyse the FINAL emitted copy, including any safety splitting; the expected line-count benefit may disappear after re-splitting. Show that honestly. A clean safety report alone does not prove equivalence to the original.

Start with collinear merging for supported, certain, constant-feed G94 XYZ linear cutting runs, with no rotary axes and no event boundaries. Preserve endpoints, direction/order, total path meaning, units, frames, feed/spindle/tool/coolant state, exact-stop behavior, dwells, breakpoints and all semantic commands. Never cross an S/M/control line just because it looks redundant; some repeated commands intentionally impose a boundary. Never replace rapids or ramp/plunge transitions in the first release. Mark diagnostics that cannot be remapped and refuse transformations through breakpoints rather than silently moving them.

Require a physical path-deviation budget supplied or confirmed by the user, separate from preview chord tolerance. An example UI proposal is 0.01 mm, but it is not a universally safe default and must not be silently selected from rendering settings. Allocate a total budget across fitting, output decimal rounding and the selected firmware's arc interpolation/normalisation. If those contributions cannot be bounded, offer export as an unverified experimental copy, not “within tolerance”; preferably defer that transform entirely.

Verification must bound the complete 3D path in both directions with order preserved, not sample a few points or compare endpoints. Also check path length/time changes and tool/frame semantics; a geometric tolerance does not guarantee equivalent finish, cutting load, tabs, clearance or workholding. Arc fitting comes after analytic equivalence checking is solid, initially single-plane constant-Z arcs only. Preserve endpoints and winding; reject ambiguous nearly closed/full-circle cases and unsupported helices. The output always needs a fresh job check and user review.

## 5. After-job learning: calibrate predictions, never machine limits

Store predicted and observed reports against a fingerprint: firmware/build/model version, normalized effective settings and axis modes, motor mapping, profile/tool/material revisions, prepared-program hash, starting frames, streaming configuration, and telemetry capability. Separate the machine-motion calibration from browser/link supply measurements. A different firmware/settings fingerprint is a new calibration, not an update to an old machine's hidden constants.

Use total execution timing and aligned source regions when evidence supports it. fs summaries identify interval/epoch totals; coalesced fl reports cannot reconstruct every segment. Do not paint an exact retrospective path from them. Check epoch, sequence, duplicates, counter wrap, missing final summary and incomplete jobs. Treat unavailable coverage as unknown. Command/boundary counters must follow the exact negotiated version, not assumptions from this design document.

Retain raw bounded summaries and model residuals locally. Fit a few bounded, interpretable corrections with robust statistics; require repeated runs and held-out validation. Exclude or label holds, edits, overrides, tool changes and deliberate waits. A single slow job should widen uncertainty, not train a permanent “weak machine.” Show “Based on 6 comparable runs,” offer reset, and invalidate on relevant setting changes. Do not infer mechanical acceleration capability, missed steps, tool wear, safe chipload or actual spindle rpm from timing alone. Learning must never raise a firmware limit or weaken a safety check.

## 6. Five shippable slices

**1 — Useful analysis without a questionnaire.** Build the event/report seam and independent motion summary. One operation with subordinate feed regimes; distance/feed/dwell/manual-stop summaries; line-density histogram/regions; existing scene links; provenance and one next question for cutting advice. No new commands, automatic tuning, file changes or promise of firmware-accurate ETA.

Detailed first-slice acceptance:

- Add `events.ts` emission to the existing interpretation pipeline and typed report extraction under advisor. Share interpretation with rendering; avoid re-parsing raw file modal state in `advisorModel`. Preserve arcs analytically and map inserted/split lines. Keep original-file and prepared-stream summaries distinct when only the former exists.
- Read the existing board snapshot via `analysisInputs.ts`; preserve native units and their conversion evidence. With no board/profile/material/tool, a supported loaded file still shows distances, programmed speeds, known dwells, stop count and density. Missing rapid rates make that component unknown rather than silently zero.
- Compute programmed motion time only for supported known feeds/rates. If an approximate achievable estimate is shown, label its assumptions and coverage, and do not let cutting-input failures suppress it. Do not reset velocity merely because an operation label changes.
- Replace the first-screen input form and empty recommendation table with Summary, Slow regions and Cutting advice. Scope input prompts to the affected card; preserve material safety notices, registered strings, Job checks and Pause/Stop behavior.
- Unit fixtures: identical path with/without an operation comment; F-only changes without a stop; plunge/cut feeds under one operation; modal feed with units changes in the same line according to the selected dialect; tools selected before M6; an arc whose display tessellation changes; dwell/barrier/inserted-line mapping; unknown feed/rotary/uncertain geometry; late worker result after replacing a file.
- Performance: deterministic cancellable analysis on the existing large-file corpus, bounded memory, and no 10,000-render-vertex cliff. Detail may be sampled, facts must remain exact or explicitly partial. Benchmark responsiveness while fake-serial streams; analysis must neither occupy the machine worker nor delay Pause/Stop.
- Fake-serial/browser test: load sample while disconnected with no advisor inputs, see a useful summary; connect and see “Board settings” provenance; change selected job/file and reject stale results; one operation heading with distinct plunge/cut details; missing material affects only advice. No new serial operations. Check 1280×720 panel containment and keyboard access to path findings.

**2 — Validated motion estimate.** Implement the pinned XYZ G94 firmware planner adapter, per-axis/motor limits, proper junction/jerk/minimum-block semantics, finite look-ahead and actual command/barrier events. Ship against independent firmware fixtures and dry-run captures. Publish model coverage and measured error; supported cases get an ETA range, others retain Slice 1 facts.

**3 — Delivery scenarios and after-job comparison.** Couple the planner to line-mode delivery; account for acknowledgements, control reserves and telemetry. Use existing fs/fl captures now and capability-gated v2/fg later. A delivered-versus-ideal scenario comparison plus measured whole-job time gives value even before learning exists. Never label a supply cause as proven without evidence that distinguishes it.

**4 — Prioritized cutting advice and bounded calibration.** Integrate sourced tools/materials and user-confirmed engagement with the motion regions, choosing the next question rather than blocking the screen. Add bounded per-fingerprint correction using repeated runs. Each suggestion identifies CAM, job setup or machine-setting review as the place to act; no one-click jerk/feed increase based on prediction.

**5 — Verified smoother copies.** Collinear merging first; restricted arc fitting only after the equivalence checks and regression corpus. Side-by-side diff, total deviation budget, re-sanitised output and user acceptance. No editing a running job or silently replacing its file.

Do not build Auto, microphone/chatter inference, an AI planner, a full virtual machine/interrupt emulator, inferred cutting engagement from a bounding box, or unrestricted multi-axis cleanup in these slices. Avoid porting all firmware for appearance of fidelity. Protect the stable interpretation/mapping seam and validate the behavior users need.

## 7. Safety limits and two documentation corrections

Analysis is advisory. It cannot authorize motion, clear Job findings, write configuration, relax an envelope, or intercept Pause/Stop. Separate “Check passed” from “Motion estimate” and “Cutting conditions not checked.” Missing evidence is not permission to invent a safe green result. Slower is not always safer: reducing feed can cause rubbing; reducing spindle alone can increase chipload and fall below useful torque/cooling ranges.

MACHINING_ASSISTANT §6.2 still describes qr as distinguishing two causes, whereas the appendix correctly calls it observational. Use the appendix's restraint throughout. Versioned fs cause totals overlap and describe time carrying flags, not seconds that a particular proposed fix will save.

There is also a substantive distinction between §6.2's “slow spindle to compensate” and `envelope.ts`, which applies the same scale to programmed F and S. Preserve the deterministic envelope; do not silently implement spindle-only advice as an allowed live action. Equal commanded ratios do not guarantee equal *actual* chipload when motion is capped or rpm is unmeasured. Resetting the advisor's desired scale to 100% on Pause/fault is not permission to send a live speed increase then: actuator sequencing and acknowledgement need a separate safety review. For this project, keep every output read-only and manual.

The crown jewel should be an explanation users can verify on their own job, with a progressively better forecast—not a machine-control policy disguised as a calculator.
