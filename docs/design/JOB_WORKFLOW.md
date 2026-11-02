# One job workflow: machine, bed, stock, placement, run

The owner's review (2026-11-02):
- "Setup and run are disconnected";
- "the bed should be tied to the machine unless it's custom (X-Carve has standard sizes and hole mounting placements); draw and render them";
- "if you load a G-code file on Run it shows it but not how it would be on the machine you have selected";
- "what if you wanted to drag it to the centre? We would need to translate the G-code";
- the tabs aren't recognisable as tabs: "a UI agent with a CNC background should modernise it and make it functional and easily understood".

## 1. One scene, one model

Setup and Run show two different 3D scenes today. They become **one machine scene**, driven by one model:

```
Machine profile ─┬─ travel envelope (machine coordinates, from the profile; checked against the board's travel settings)
                 ├─ bed: spoilboard size, thickness, mounting-hole or T-track pattern (from the preset; editable for custom)
Setup ───────────┼─ fixtures (DXF/SVG + height, position)
                 ├─ stock (shape, size, material, position on the bed)
Job ─────────────┼─ the G-code file, and its placement: the planned work zero (G54) in machine coordinates
Board (live) ────┴─ the real G54 offset and the machine position, read from the board
```

- **Where it appears:**
  - Run shows the scene with the job on the bed.
  - Setup is not a separate page. It's the editing mode of the same scene: "Edit setup" opens the stock, fixture and bed panels beside the scene you're already looking at.
  - Analyze's checks use the same model: cuts into the spoilboard, clamp collisions, outside travel.
- **Selected machine:** the job is always shown on the selected machine's bed. "No machine profile" means a generic bed, and a prompt to pick one.

## 2. Machines carry their real bed (presets)

- **Each preset carries:**
  - the travel envelope;
  - the spoilboard (wasteboard) size and thickness;
  - the mounting pattern: threaded-insert hole grid, T-tracks or T-slot table, with spacing, offsets and thread size;
  - the home position and corner;
  - drawing details for the 3D and 2D views.
- **Presets to cover:**
  - X-Carve 500 mm and 1000 mm;
  - Shapeoko 3, 4 and 5 Pro variants (hybrid table with T-tracks);
  - OpenBuilds LEAD 1010/1515 and WorkBee;
  - 3040, 6040 and similar T-slot routers;
  - custom.
- **Numbers need sources.** Every dimension and hole pattern cites its source: the manufacturer's drawings, manuals or product pages. Anything unverified is flagged `placeholder` and shown as such, as with materials.
- **Forking:**
  - A machine copied from a preset inherits the bed. Users can override it, for example a custom spoilboard, a hole grid they drilled themselves, or an uploaded DXF/SVG of their bed.
  - Custom machines start blank, and the bed is entered or imported.
- **Rendering:** the scene draws the bed with its holes and tracks, so clamps can be placed on real holes. Optionally, clamps snap to holes.

## 3. Placing the job: move work zero, don't rewrite the file

In CNC, putting a job somewhere else on the bed normally means **moving work zero (the G54 offset)**, not changing the G-code. run follows that convention.

- **Drag the job in the scene, or use "Centre on stock" / "Align corner".** This sets the job's **planned work zero**: a point in machine coordinates saved with the job's setup. The file itself is unchanged.
- **Snap targets:** stock corners and centre, fixture datums, bed holes. The scene shows the resulting machine-coordinate box against the travel envelope ("fits" / "exceeds X travel by 12 mm").
- **Making it real:**
  - **Phase 1 (read-only):** run reads the board's actual G54 offset and machine position with GETs (allowed now), and shows **plan versus board**: "Your board's work zero is 14.2 mm right of your plan". The scene can show the toolpath where it *will actually* cut. That safety check is valuable even before motion.
  - **Phase 2 (motion):** "Jog to planned zero" (shown, confirmed, at a safe Z).
  - **Settings-write phase:** "Set work zero here" (G10 L2/L20), with read-back.
- **When rewriting the file is right** (later, optional): rotate 90°, mirror, an array of copies, nesting several files. That's a **transform** that produces a new file version. It is always shown before and after, re-checked by the sanitiser, never applied silently, and the original is kept. A plain translation stays a work-offset change by default; "Bake placement into the file" is an explicit export for people who want it.

## 4. Information architecture (proposal for the design pass)

The rail today has ten peers. Proposed grouping:

| Rail | Contents |
|---|---|
| **Job** (was Run + Setup) | The machine scene; a left column with the job steps: **1 Machine → 2 Stock & workholding → 3 Place job → 4 Check → 5 Run**; the live panels (position, jog, spindle) on the right; G-code, Console and Live at the bottom |
| **Library** | Machines, Tools, Materials (sub-tabs) |
| **Board** | Connection, configuration, settings, backups, firmware |
| **Projects** | Projects and their files; "Open in Job" |
| **Analyze** | Deep analysis and the feeds/speeds advisor |
| Settings · Safety | Unchanged |

Each step shows a status (done, needs attention, blocked), so "what do I do next" is always visible. Pause and Stop job stay fixed in the machine strip.

## 5. Visual redesign brief (for a UI designer with CNC experience)

- **The problem:** too much blue. Tabs and segments don't read as tabs. There's a lot of small text, and hierarchy is weak in places.
- **The goal:** a modern, calm, highly legible shop-floor tool, at the level of gSender, Carbide Motion, Fusion and Easel, but ours, in the synthetos blueprint style.
- **Specifics:**
  - real tab affordances: underline or segmented controls with clear selected states, not blue text;
  - a neutral base, with blue for primary actions and selection only, tan for drafting and secondary accents, and safety colours reserved;
  - a type scale with fewer sizes and larger key numbers;
  - icons alongside labels in the rail and the job steps;
  - consistent card and panel styling;
  - generous hit targets for gloves and shop use;
  - every state has an empty, a loading and an error look;
  - keyboard shortcuts shown.
- **Constraints:** SAFETY strings and Pause/Stop rules, no document scroll, the CSP, contrast of at least 4.5:1, light and dark.
- **Process:**
  1. An audit of the current screens with a written critique.
  2. A design system update (tokens and components).
  3. Implementation in the real app, on a branch.
  4. Screenshots for owner approval before merge.

## 6. Phases

1. **Now:** the unified scene (Run and Setup share it); machine presets with sourced beds; job placement as a planned work zero; plan-versus-board G54 comparison (read-only); the IA regroup; the visual redesign.
2. **Phase 2:** jog to planned zero.
3. **Settings writes:** set work zero; write machine-profile settings.
4. **Later:** file transforms (rotate, mirror, array, nest), clamps snapping to holes, bed import from DXF.
