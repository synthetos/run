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
- **Two causes, told apart by `qr`:**
  1. **Planner starving:** qr is high while cutting. Lines arrive slower than they execute, so the segments are too short or the stream is slow.
     - Fix now: slow the spindle to hold the chipload.
     - Fix next time: smoothing (TB-07) or streaming changes.
  2. **Machine-limited:** qr is low or full, and velocity is capped by acceleration and jerk at corners and short moves.
     - Fix: slow the spindle in proportion.
     - Once the firmware's planned feed-limit advisor reports the cause and a percentage, that replaces the guesswork.
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
