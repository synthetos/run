# Machining assistant: tools, materials, store, feeds and speeds, live tuning, AI, simulation

The owner's direction (2026-11-02):
- the tool library records where each tool was bought;
- Synthetos sells end mills and materials, with the store mocked for now;
- there is a materials library users can add to;
- the UI helps with feeds and speeds for the actual machine;
- an AI integration, with shims now even if it doesn't work yet;
- live feedback from the board ("goose, slow down"): when the machine can't reach the programmed feed, the chipload drops, so the spindle should slow too ("autotune");
- the preview supports jobs with many Z depths.

Companion to [WORKSPACE_FEATURES.md](WORKSPACE_FEATURES.md). Phase tags follow it: **P1** read-only now; **P2** motion and jog; **P3** jobs; **SW** settings writes; **FW** needs firmware; **Cloud** needs the account service; **Mock** has UI and data now with no backing service.

## 1. Principles

1. **The assistant advises, the machinist decides.** Every number comes with its reasons, its source and a range. Nothing changes a job without a visible, logged, reversible action.
2. **AI proposes, rules decide.** Every suggestion, from the rules engine or an AI, passes through one deterministic safety envelope (§6.4) before it can reach the board. AI output is structured data checked against a schema, never free text turned into commands. AI never talks to the board.
3. **Real time is deterministic.** The live loop runs locally with the rules engine; AI is too slow and too variable for it. AI works before a job (planning), after it (review) and as a periodic coach.
4. **Numbers have sources.** Every built-in material and tool value names its source (manufacturer datasheet, handbook, Synthetos measurement) and version, or is marked as a placeholder. Nothing marked as a placeholder ships as advice.
5. **Pause and Stop are never involved.** No assistant mode gates, delays or reinterprets them.
6. **Tenet 1 holds:** buying something never navigates away from the workspace or drops the board. Checkout opens in a new tab.

## 2. Tool library (P1, Cloud)

Each tool is a versioned record in the user's account, plus a local cache that works signed out.

| Field | Notes |
|---|---|
| `id`, `version`, `name` | The name is the user's own ("¼ in 2-flute up-cut") |
| `type` | flat, ball, bull-nose (corner radius), V-bit (angle, tip width), chamfer, drill (point angle), engraver, O-flute, surfacing, thread mill |
| geometry | diameter, shank, flutes, flute length, overall length, stickout (set per holder), helix, corner radius, V angle |
| `toolMaterial`, `coating` | carbide, HSS, cobalt; uncoated, ZrN, TiAlN, AlTiN, DLC… |
| `manufacturer`, `partNumber` | |
| `description`, `notes` | Plain text; notes are the user's ("chatters above 18k in oak") |
| `purchase[]` | `{ vendor, url, sku?, price?, currency?, boughtAt?, kind: 'store' \| 'link' }`. Several sources per tool, plus "Reorder" |
| `datasheetUrl` | Link only: we never fetch it from the browser (§8) |
| `cuttingData[]` | `{ materialRef, vc, fz, ap, ae, coolant, source: 'manufacturer' \| 'synthetos' \| 'user' \| 'ai', note }`. Manufacturer data beats generic data |
| `life` | Minutes cut, broken down by material, from jobs run (P3). Feeds "probably dull, reorder?" nudges and the advisor's wear factor |
| `firmwareSlot?` | Unused. TinyG has no firmware tool table: tools live in software. Kept only in case g2core gets one later (T number, length offset) |
| `tags`, `images` | Image upload comes later (Cloud) |

Store tools (§4) arrive with verified geometry and cutting data in one click.

## 3. Materials library (P1, Cloud)

There are three sources, shown together with a badge on each: **Built-in** (curated, versioned, cited), **Mine** (the user's own, or a fork of a built-in that inherits values until edited) and **Store** (Mock: blanks we sell, linked to their built-in material record).

| Field | Notes |
|---|---|
| `id`, `version`, `name`, `family`, `grade` | Families: aluminium, brass/copper, steel (advanced), plastics (cast and extruded acrylic, HDPE, POM/Delrin, PC, nylon, UHMW), wood (softwood, hardwood, plywood, MDF, HDF), composites (carbon fibre, G10/FR4), foam, PCB |
| physical | hardness, density, specific cutting force `kc` (N/mm²) for power checks |
| `cutting[]` | per tool material: surface speed `vc` range (m/min), a chipload factor or a chipload-by-diameter curve, maximum axial and radial engagement for hobby/medium/rigid machines |
| `coolant` | required / recommended / none / avoid, with the reason ("aluminium welds to the flutes without air or mist") |
| `behaviour` | melts (acrylic: keep the chips thick, don't dwell), work-hardens, chip evacuation, grain direction |
| `safety[]` | Shown wherever the material is chosen, never hidden. Examples: "Do not machine PVC: it releases corrosive, toxic gas"; "Carbon fibre, G10 and FR4 dust is hazardous: extraction and a respirator"; "MDF: dust extraction"; magnesium is not offered (fire) |
| `stockForms[]` | Sheet thicknesses and bar diameters available, which feed the stock picker |
| `purchase[]`, `description`, `notes` | Same shape as for tools |

Stock (Setup view) references a material by id and version, so a job records exactly what it was cut from.

## 4. Store (Mock now; Shopify later)

- **Today:** the Synthetos store is Shopify (`synthetos.myshopify.com`). The owner has API access (2026-11-02). Use a **Storefront API** token (catalogue, availability, cart and checkout URL), held as a Worker secret and called through our Worker. **Admin API** keys are never used by run and never reach the browser. Products are tagged in Shopify (for example `run:tool`, `run:material`), and a metafield links each product to its versioned tool or material spec.
- **Provider seam:** a `StoreProvider` interface with `catalog()`, `product(sku)`, `cartUrl(items)` and `availability(skus)`.
  - **Now:** `MockStore` serves a small fixed catalogue of end mills, V-bits and material blanks.
  - **Later:** `ShopifyStore`, using the Storefront API through our Worker, so no store token reaches the browser.
- **Product record:** SKU, title, price, stock state, our own images (the CSP doesn't allow hotlinking), and a link to a versioned tool or material spec.
  - "Add to my library" copies the spec, with `purchase.kind = 'store'`.
- **Where it appears:**
  - the Tools and Materials views ("Shop end mills", "Shop materials");
  - the advisor ("this job wants a 3 mm O-flute for acrylic: you don't have one");
  - reorder nudges from tool life.

  It never appears in the Run view while a job runs.
- **Checkout:** opens in a new tab (`rel="noopener"`). run keeps no payment data.
- **Third-party links:** the user's own purchase links stay plain links.
- **Owner decisions:** whether to use affiliate tags; which products to list first.

## 5. Feeds and speeds advisor (P1 rules engine; AI later)

### 5.1 Inputs

- **Machine** (from the machine profile):
  - drive type per axis: belt, lead screw, ball screw, rack;
  - frame class: hobby / medium / rigid (from the preset, which the user can adjust);
  - gantry span;
  - axis max feed and jerk, read from the board (P1 read);
  - the spindle: trim router with a dial, or a PWM/VFD spindle; min and max rpm; power; and whether S controls it;
  - for dial routers, the dial-to-rpm table. Example to verify: Makita RT0701C dial 1-6 is about 10k-30k rpm.
- **Tool and holder:** stickout.
- **Material and coolant:** none / air / mist / flood.
- **Operation:** slot, pocket, adaptive, profile, finish, drill, V-carve. Its depth (ap) and stepover (ae) come from the G-code analysis or CAM comments, or the user enters them.

### 5.2 Model (deterministic, unit-tested)

1. **Spindle speed:** `n = vc·1000 / (π·D)`, clamped to the spindle's range. Small tools on routers usually hit the maximum rpm.
2. **Chipload:**
   - the target `fz` comes from the material curve for this diameter, the manufacturer's data if present, and the frame-class factor;
   - for ae < D/2, radial chip thinning applies: `fz_prog = fz · D / (2·√(D·ae − ae²))`.
3. **Feed:** `vf = n · z · fz_prog`.
4. **Envelope checks, each with a reason:**
   - **Spindle power:** `P = ap·ae·vf·kc / 60e6` kW against the spindle's power.
   - **Machine:** vf against the axis maximum, and the ap/ae limits for the frame class.
   - **Deflection:** tool deflection from cutting force and stickout (cantilever with an effective diameter). Flagged when it exceeds about 0.02 mm for finishing or 0.05 mm for roughing.
   - **Rubbing floor:** chipload below about 30-40 % of target means heat and fast wear.
   - **Coolant:** a material that needs coolant, with none available.
5. **Achievable feed (the predictive half of autotune):**
   - The analyzer already models the planner from segment lengths, junction deviation and jerk.
   - It predicts the feed the machine will actually reach in each operation ("these 1.3 mm stepovers peak at about 1100 of 1500 mm/min"), and computes the chipload at that feed, not at the programmed one.
   - The fix it suggests is rpm for this run, or a smoother toolpath next time (TB-07 arc fitting and segment merging).
6. **Output:** for each operation, *conservative / balanced / aggressive* values, the programmed values compared, a verdict, plain reasons and sources. Example verdicts:
   - "Too aggressive: 2 mm deep at 1500 mm/min in 6061 needs about 0.9 kW; your router's limit is about 0.7 kW with no coolant";
   - "Rubbing: 0.01 mm chipload at 30k rpm; slow the spindle to 18k".

### 5.3 Engines

```
interface AdvisorEngine {
  id: string; kind: 'rules' | 'ai'; available(): Promise<boolean>;
  plan(ctx: AdvisorContext): Promise<Recommendation[]>;          // before the job
  coach(window: TelemetrySummary): Promise<Suggestion[]>;        // periodic, not real time
  review(job: JobRecord): Promise<Review>;                       // after the job
}
```

- **`RulesEngine`:** the default, local, offline and deterministic.
- **`MockAiEngine`:** canned, clearly labelled "AI assistant (preview)" output.
- **`CloudAiEngine` (later):**
  - The browser sends a summary to our Worker: machine, tool, material, operation summaries and aggregated telemetry. Never raw streams, never identity beyond the account.
  - The Worker calls an AI model (configured in the Worker), so no model key ever reaches the browser. The model is configuration, not code.
  - It needs explicit consent per account, has a cost and quota policy (owner decision), and falls back to rules when offline.

Every engine returns structured data validated against a schema. The envelope (§6.4) bounds whatever it proposes.

## 6. Live tuning: "goose, slow down" (Advise in P3; Auto behind FW plus a safety review)

### 6.1 What the board tells us (edge-next today, plus mocks)

- **Already reported:** `vel` (actual path velocity), `feed` (commanded F), `qr` (planner buffers free), `line` and `stat`, every 100-250 ms.
- **Mock until the firmware adds it:** a spindle state report: on/off, direction, the commanded S after the p1csl..p1csh clamp, and possibly the PWM duty. TinyG has no spindle speed sensor, so actual rpm is never reported. Chipload always uses the commanded S, labelled "commanded". A VFD with feedback is a possible later source.

### 6.2 Live chipload and its causes

- **Live chipload:** `fz_live = vel / (n·z)`. This is measured over a rolling window of 2-5 s while cutting. Rapids, ramps near corners and holds are excluded.
- **What `qr` can and cannot say** *(amended 2026-11-09, docs/design/ANALYZE.md §7):* `qr` is observational, as the appendix says. A high `qr` while cutting means the planner had little motion queued; it does not say why. It does not tell "the host or link is slow" apart from "the segments are short", and a low or full `qr` does not prove the motion is limited by acceleration or jerk. Two situations are worth telling the user about, without claiming the cause:
  1. **Little motion queued while cutting** (high `qr`). Possible reasons: very short segments, a slow stream, or a deliberate wait. Next time, look at the dense sections in Analyze (smoothing, TB-07, or CAM settings).
  2. **A full queue while velocity stays below the programmed feed.** Possible reasons: corners and short moves where acceleration and jerk cap the speed.
  - Neither one is reported as proven until a capability-gated firmware report (the feed-limit `fs` summaries, a later `fg` with "input pending" and "no input") says more, and even then those describe what the board observed, never a slow cable, host or CPU. `fs` cause totals overlap: they are time carrying a flag, not seconds a particular change will save.
  - **Spindle-only advice is not the envelope.** The idea of slowing only the spindle to hold chipload is not what `envelope.ts` does: the deterministic envelope (§6.4) scales programmed F and S together, never S alone. Spindle-only advice stays a written suggestion for the user; it is never an allowed live action. Equal commanded ratios do not guarantee equal actual chipload when motion is capped or rpm is not measured, and resetting the advisor's scale to 100 % on Pause or a fault is not permission to send a live speed increase. Every output stays read-only and manual.
- **Unsafe direction:** live chipload above target, for example after a feed increase. Not possible today: run never raises the feed.
- **Later ideas:**
  - spindle load from a VFD;
  - chatter detection through the browser microphone (FFT, opt-in, local only).

  Open-loop steppers can't report lost steps, and run never claims to detect them.

### 6.3 Modes (per job, shown in the Live job tab)

| Mode | Behaviour | Phase |
|---|---|---|
| Off | Telemetry only | P3 |
| **Advise** (default) | Plain messages with numbers: "Slow down: this pocket averages 74 % of programmed feed. Chipload 0.018 mm is below the 0.025 floor. Spindle 13,300 rpm (−26 %) keeps the chips thick." Dial routers: "turn the dial to 3" | P3 |
| Assist | Each suggestion has an **Apply** button; one click applies it, one click returns to 100 % | P3 + actuator |
| Auto | Opt-in per job; bounded by §6.4; every change logged in the timeline and visible; "Return to programmed" is always one click | P3 + actuator + safety review |

### 6.4 The envelope (applies to every engine and every mode)

- **Feed:** never above programmed F. Never above the axis maximums.
- **Spindle:** never above programmed S, the tool's maximum rpm or the spindle's maximum. Never below the spindle's minimum. At the minimum, the advisor says so and stops.
- **Ratio:** the spindle and the feed only ever move down together, so the chipload stays within the band and never rises.
- **Rate:** changes are limited to 5 % per 2 s, with hysteresis. Nothing changes during tool changes, ramps-in or the first seconds of a cut.
- **Auto drops to Off,** and the overrides go back to 100 % at the next safe moment, on:
  - hold, alarm, fault, lost connection, ORPHANED_MOTION, tool change, job end, or any Pause or Stop press.
- **Logging:** every applied change is logged with its reason and inputs, and kept in the job record.

### 6.5 Actuators: how a change reaches the board

- **A. Firmware overrides (FW, preferred).**
  - `{rt:{fo:…}}` and a spindle-speed override; the wire format isn't decided.
  - Immediate, and inside the planner's jerk limits.
  - Mocked in the UI now (`telemetry.mjs` seam).
- **B. Stream rewrite (no firmware change; it needs its own safety review).**
  - run streams the file line by line, so it can scale the F and S words of lines not yet sent. Where F is only implied, it inserts an explicit F.
  - The rewritten lines pass the same sanitiser. The original file is untouched, and a banner reads "Stream modified: feed 80 %, spindle 80 %".
  - Latency is the queued planner time, often several seconds, so it is only suitable for slow, sustained conditions.
- **C. Manual (works on any machine):** the advisor tells the operator. This is the only option for dial spindles.

### 6.6 Learning from each job

- **Measuring the machine:** after a job, run stores the feed the machine actually achieved for each operation and segment length. This builds a machine "fingerprint" (effective acceleration per axis) that makes the next prediction (§5.2.5) more accurate.
- **Job report:** the job report shows programmed against achieved feed, the time lost, and what fixed it.

## 7. Preview and stock simulation, with many Z depths (P1 preview; live progress in P3)

Real jobs have many depths:
- step-downs (several passes per operation);
- operations at different depths, such as pockets, through-cuts and tabs;
- ramps and helical entries;
- drilling cycles;
- V-carving, where Z varies with width;
- 3D surfacing with a ball nose, where Z varies continuously;
- several parts at different work offsets (G54-G59).

The simulation handles all of them.

- **Model:** a heightfield of the stock top (2.5D dexels).
  - Exact for 3-axis work, which cannot undercut.
  - The cell size adapts to the stock and the smallest tool: 0.1-0.25 mm, with refinement where needed.
  - Each move removes the tool's swept volume: flat, ball, bull-nose, V, drill point, chamfer.
  - It runs in a worker and is a WASM candidate (the roadmap's G-code engine); the main thread only renders.
- **Display:**
  - Toolpath, Result and Both.
  - Colour by depth, or by operation.
  - Hover shows the depth at a point and which line cut it.
  - A section slider shows a cross-section.
  - A depth legend per operation.
  - The playback scrubber moves through passes.
- **Checks shown in Analyze, with the line number:**
  - **depth against stock:** "cuts 0.4 mm into the spoilboard" or "doesn't cut through: 0.3 mm left";
  - **workholding collisions:** using the fixture and clamp heights from Setup, "line 1,204 passes through clamp 2 at Z 3.0 (clamp top 12.0)";
  - **rapids:** a rapid below the stock top or into the material;
  - **reach:** the deepest cut against the tool's flute length or the holder ("the collet hits the stock below 22 mm");
  - **overall depth:** the deepest Z against the machine's Z travel.
- **During a job (P3):** the same simulation is driven by the reported `line`, so the stock is cut on screen as the machine cuts. It catches up after reconnects from the line number, and never claims more than the reports show.
- **Planner view during a job (owner, 2026-11-02; P3):** the toolpath is coloured by where each move is in the pipeline:
  - **cut**, already executed: dimmed;
  - **executing now**: the line in the latest `sr` `line`, highlighted, with the tool marker;
  - **queued in the planner**: lines sent and accepted but not yet executed, in a distinct band colour;
  - **not sent yet**: the normal preview colour.

  *Amended 2026-11-10 (owner: "so starving is visible at a glance"):* the lines keep their tool colours and the states differ in strength and pattern, so they read without colour vision: **done** faint; **executing** in the live colour; **in the planner** (executing to the last acknowledged line) at full strength, amber while starving; **sent, waiting for the acknowledgement** in fine dashes; **not sent** dimmed. A legend says what each look means while a job runs, and a "Planner starved" chip shows on the viewer's bar when starving lasts more than about half a second. All of it from what run already has (the acknowledged and sent lines, the reported `line` and `qr`); no new board traffic. While the spindle is on the live tool marker turns, the way the board reports (M3 clockwise from above), a few redraws a second; under reduced motion, or on a software renderer, it does not turn and the bar shows "↻ Spindle on" instead (`gcode-view/src/markerSpin.ts`).

  The queued band's length is the look-ahead the machine has. When it shrinks to almost nothing while cutting, run is starving the planner. A small gauge beside the 3D view shows planner buffers in use (from `qr`) and the queued time in seconds, and turns to a warning when starving. That ties directly to the live tuning in §6.2. Accuracy:
  - Run knows which lines it has sent and been acknowledged for, and the board reports the executing line.
  - One G-code line can be several planner blocks (arcs, long moves), so the band is line-accurate, not block-accurate. The gauge uses `qr` for the true block count.
  - The firmware's planned feed-limit reasons (§6.2, firmware step 1) can later colour queued blocks by cause, for example corner-limited or too short to reach feed.
- **Breakpoints (P3; the gutter and per-file storage ship now):** click a line's margin in the G-code panel to set one.
  - Run stops sending lines before the breakpoint line. The moves already queued finish and the machine comes to a clean stop there: the queue drains, so no feedhold is needed.
  - The strip then shows "Stopped at breakpoint · line N", with "· spindle still on" when `spe` 1 is reported. Resume streams on from that line.
  - A breakpoint takes effect only on a line not yet sent: lines in the planner cannot be recalled, so the panel says so when one sits inside the queued band.
  - Breakpoints never gate Pause or Stop job.
- **Round stock and rotary:** round stock lying flat or standing up is a 3-axis heightfield. A rotary A axis needs a cylindrical heightfield; that is a later phase.

## 8. Security and privacy

- **User URLs:** purchase and datasheet links accept http(s) only. They render with `rel="noopener noreferrer nofollow"`. The browser never fetches them: no previews, no hotlinked images, and the CSP stays strict.
- **AI calls:** these go through our Worker only, with consent and a summary payload. A per-account setting turns AI off entirely.
- **Store:** the store token is server-side only, and checkout is external.
- **Sharing:** material and tool records the user shares are reviewed before they appear in any public catalogue (later).

## 9. Code homes

| Package | Contents | Rules |
|---|---|---|
| `packages/library` | Schemas and validation for Tool, Material, Stock, Fixture and StoreProduct; URL sanitising; versioning and forking | No network, no machine import |
| `packages/advisor` | The deterministic feeds and speeds model, achievable-feed prediction, the live chipload estimator, the envelope, `AdvisorEngine` plus `RulesEngine` and `MockAiEngine` | No network, no machine import; pure and unit-tested |
| `packages/sim` (later) | The heightfield simulation and collision checks | Worker-hosted; WASM candidate |
| `apps/web` | The views; `StoreProvider` (Mock); the cloud AI client (later) | Network only through the existing cloud client |

## 10. Owner decisions open

1. Store: which products first; whether to use affiliate tags on third-party links.
2. AI: a paid or free tier, quota, and the consent wording.
3. Auto mode: is it wanted at all, or only Advise and Assist? (Recommendation: ship Advise first, and add Auto only with firmware overrides and its own safety review.)
4. Stream rewrite (§6.5 B) as an interim actuator before the firmware has overrides.
5. Built-in data sources: whose chipload and speed data we cite (manufacturer tables, a handbook, our own measurements).

## Appendix: runtime feed-limit frames (TinyG 450.01 and 450.02, format v1)

The firmware maintainer's written spec is `TinyG/.analysis/feed-advisor-design.md` ("Step 2 push interface", "What the causes mean"); the frames below are what 450.01 ships (450.02 changes none of them), confirmed from the source and bench 2 captures on 2026-11-03. Steps 1 and 2 only: the firmware reports **nothing about starvation** on these builds (format v2, the supply-gap and boundary fields, the `fl` gap flag and the job flag are designed and parked until run streams whole jobs).

- **Opt-in, RAM only.** `{"rt":{"fi":N}}`, N = 1..60 s (larger clamped; the `r` reply echoes the value applied; 0 = off). Off after every reset and never persisted: run sets it at job start and after any reset (`job.ts` `feedLimitLine`; `{"rt":null}` must list `fi`). `{"rt":{"hb":N}}` is the same shape for the heartbeat.
- **Summary push** every `fi` seconds while a job window is open, and once more at the end of motion: `{"fs":{"v":1,"e":E,"q":Q,"c":[c0,c1,c2,c3,c4,c5],"ct":CT,"cd":CD.ddd}}`, optionally `,"x":1`. `v` format version (run accepts 1 and ignores a window of any other version). `e` window epoch: it increments when `fi` goes off→on, and a new window zeroes the totals. `q` sequence within the window. `c[]` cumulative milliseconds of cutting time spent below the programmed F per cause, in this order: axis cap (`fr`/`vm`), junction (corner), exact stop (G61), short (too short to reach cruise), single segment (short-block profile), other (ramps, end of path, downstream braking, nothing tagged). A segment counts under every cause it carries, so the entries can sum to more than `ct`. `ct` cumulative cutting ms, `cd` cumulative cutting mm (three decimals, always mm under G20). `x:1` means a counter wrapped: discard the window. All values are absolute since the window opened: run differences consecutive summaries; a lost frame loses nothing.
- **Cause-change push**, at most 4 per second, only when the executing move's (kind, cause mask) changes: `{"fl":{"k":K,"m":M,"p":P,"n":N}}`. `k` 0 nothing running (idle, hold, dwell, command), 1 feed move, 2 rapid. `m` bit mask: 1 axis cap, 2 junction, 4 exact stop, 8 short, 16 single segment; 0 = at F, or below F with no tag. `p` integer percent of programmed F the move cruises at (not clamped at 100), null unless k = 1 and F > 0. `n` executing G-code line (runtime, not model), null when nothing runs. It is rate-limited and coalesced: one frame is never evidence of anything.
- **Heartbeat** `{"hb":{"stat":S,"hold":H,"up":UP,"qt":"token"|null}}` when `hb` > 0 and link and machine have been quiet for `hb` s. **Queue report** `{"qr":N}` buffers free (32 max) with `qv` 1, persisted, not RAM-only.
- **Framing.** `fs`, `fl`, `hb`, `qr` each have one unique top-level key, no footer, are never acknowledgements, and can arrive between a request and its `r` frame. Anything that is not `r`/`sr`/`er`/`qr`/`fs`/`fl`/`hb` is logged, not an error.
- **Read on demand** (step 1): `{"rt":{"fs":null}}` the current summary; `{"rt":{"flk":null,"flm":null,"flp":null,"fln":null}}` the current `fl` fields; `{"rt":{"fi":null}}`, `{"rt":{"hb":null}}` the settings.
- Only G94 linear XYZ feed segments count. Rapids, G93, rotary moves and deceleration into a feedhold do not. 450.02 also validates status-report selections, bounds `si`, and alarms on a job kill (^D) by design.

### What run shows (observational, H78)

- **During a job, one line** from the latest summary deltas over the last interval: "Below the programmed feed: short moves 41%, corners 18%", plus the executing move's `p` as a small gauge with its cause word (`fl` is the executing move, `fs` the window). Per-axis is not available from these frames: axis cap says "an axis", not which; naming one from the settings is a later, separately labelled step.
- **After the job**, from the final summary: cutting time, cutting distance, share of cutting time per cause, and the plain-language notes below.
- **The words per cause.** Axis cap: "an axis's own speed limit (`fr`) held the feed below F": normal when F exceeds the machine; worth saying whenever it is more than a few percent. Junction: "the planner slowed into corners": normal on cornered paths; large on a smooth path means conservative junction settings (`jd`, `ja`). Exact stop: G61 in the program, by design. Short and single segment: "moves too short to reach the feed between entry and exit": dense CAM output and jerk settings, the typical "dense file runs slow" signature; worth a note above about 30% of cutting time. Other: ramps and end-of-path braking, expected at the start and end of every chain; a large share mid-job means the planner kept running out of look-ahead, which can be host starvation but is **not proven by this frame**.
- **Never inferred from these frames:** starvation or its cause, a specific axis, a feed override (not reported), machine health, or anything from a single `fl`. The `qr`-based hint run already has is labelled "observational: the planner ran out of motion; the cause is not reported by this firmware", never "host too slow" or "board too slow".
- **Replays.** `packages/testkit/fixtures/feed-vectors-starving.jsonl` is every frame bench 2 (edge-next 425fa92e = 450.01) sent during a host-starved run of the dense 0.04 mm perfbench section (one line per 80 ms); a feed-limited capture at full line-mode speed follows the same shape. In v1 starvation looks like `qr` near 32 between lines and `fl` flipping to k = 0 at each gap, and nothing says why.

### Feed-limit step 3 (designed, parked until run streams whole jobs)

- **Job flag.** `{"rt":{"job":1}}` when run starts streaming a job; `{"rt":{"job":0}}` right after the last motion line is sent, and before run's own deliberate stops (M6 tool change, breakpoints), with `job:1` again on resume. Its capability probe (`jobFlagSupported`) finds nothing on 450.01/450.02, so it is never sent.
- **`fs` v2.** `"v":2`. `c` gains a seventh entry, command boundary. `"g":[ms_waiting, ms_unavailable, gap_count]`. `"b":[[count,ms],[count,ms],[count,ms]]` for spindle/S, coolant and other. Cumulative, `x` as in v1.
- **`fl` while starved.** `{"fl":{"k":0,"m":0,"p":null,"n":<last executed line>,"g":1|2}}`: 1 = input pending (a full data line was buffered or being dispatched, or local work such as an arc was in progress), 2 = no known complete input. Both are observational, never causal (independent review of the firmware); gap times are about 10 ms SysTick steps plus loop delay.
- **Display, when built.** Gap g 2: "No data was ready for the machine (about 1.2 s, 4 times)" with link tips (keep the tab visible, no sleep, a direct USB cable); gap g 1: "Data was waiting, but the board didn't get it planned in time" with the smoothing suggestion; neither ever presented as a proven cause. The planner view's queued band turns amber while starved. Repeated command boundaries: "Spindle commands between moves forced N stops (about T s lost)" with an offer of a cleaned copy (re-checked); Analyze flags this before the job starts.
