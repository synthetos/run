# Workspace tenets

The owner's direction for run.synthetos.com (2026-11-02): "the whole workspace
for TinyG and g2core", "so clean and nice it should rival anything the hobby
world has seen", "clean, professional, ties into our theme, and people want to
use our setup." Every design and build step is reviewed against these tenets.

## 1. One page. It never reloads.

- run is a single-page app. The machine worker and the serial connection live
  for the whole session. Opening Configure, Machines, Projects, Analyze or
  Settings never navigates away and never drops the board.
- The page does not scroll. Panels scroll inside themselves, and modals and
  drawers may scroll. The workspace frame stays fixed at 1280×720 and up.
- The safety bar, the machine-state band, Pause and Stop, and the connection
  are present in every view.

## 2. Clean, professional, and ours

- The synthetos.com blueprint theme: the same tokens, type (IBM Plex), light
  and dark modes, and drafting-grid accents used with restraint. It should
  feel like part of synthetos.com, not a separate tool.
- Visual quality to rival the best (gSender, CNCjs, UGS, ChiliPeppr, Easel):
  - a calm hierarchy and generous spacing;
  - large tabular digits for position;
  - no browser-default controls;
  - no debug labels;
  - no layout shift.
- People should want to use it: it is fast, obvious and pleasant.

## 3. Controls that know the machine's state

- Show what matters now.
- Pause and Stop are never gated (SAFETY). They are always reachable and never
  blocked by sign-in or by a mode, but they are presented by state:
  - quiet when the machine is idle ("Machine idle");
  - prominent when it is moving, holding or has work queued.
- Distinguish "unavailable because irrelevant" from "gated". Stop and Pause
  are never the former when anything could be moving.
- Every message says what happened in plain words ("Paused: the machine was
  idle, nothing changed"), never a bare "Pause requested".

## 4. Plain language, details on demand

- No firmware jargon on the surface ("polled mpo" becomes "Live · 0.2 s").
  Tooltips and expanders carry the detail for people who want it.
- Settings are grouped and explained in plain words, with the raw key shown as
  secondary text.

## 5. Visual configuration

- An accurate, interactive drawing (SVG) of the actual board, generated from
  the board definitions (TinyG hv variants first, g2core boards later). It is
  not a generic "parts and pins" editor.
- Click an input (such as X-min) to set its function, NO/NC polarity and
  homing role.
- Click a motor port to assign an axis and set the motor size, step angle,
  microsteps, travel per revolution and current, with immediate visual
  feedback.
- The resulting settings are shown as a clear difference from the board's
  current values. Writing them to the board is a later, separately gated phase
  (Phase 1 is read-only).
- Facts from the private hardware design are used only as derived data, never
  published as files or images (RUN_PLAN rule 6).

## 6. Machines are a library you make your own

- Presets for popular machines (X-Carve, Shapeoko, 3040/4060/6040 routers,
  OpenBuilds and others), each with a source and a version.
- The user picks one, forks it into their own machine, customizes it, and
  keeps it in their Synthetos account (GitHub sign-in), synced across devices.

## 7. Projects

- Files, jobs and run history belong to projects in the user's account, synced
  to the cloud (Track A2). Local-only use keeps working when signed out.

## 8. The G-code engine is designed in from the start

- The interpreter, analysis and optimization (TB-07: arc fitting and segment
  merging), time estimates, live job analysis and later shape generation have
  defined homes in the interface now, even before they are built.
- An optimized file is always the user's choice, shown before and after,
  re-checked by the sanitiser, and never armed automatically.

## 9. Safety stays exactly as strong

- SAFETY.md strings stay byte-exact. They are presented well, not reworded.
- Every gate stays green: layering, bundle scan, Web Serial confinement and
  CSP/Trusted Types.
- No new writes to the board without their own reviewed phase.
- Phase 1 remains read-only.

## 10. Built to last

- It is modular: the shell, views, panels and the engine have clean seams.
- It is keyboard accessible, with contrast at or above 4.5:1.
- The 3D preview runs at 60 fps.
- Screenshots are taken at 1280, 1440, 1920 and 390 px wide, in light and
  dark, for every review.
