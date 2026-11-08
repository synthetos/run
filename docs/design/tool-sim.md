# Tool shapes and stock carving in the 3D view

Owner request (2026-11-07, after a bench run of braid_500mm.gcode): "make the 3d preview an endmill that we can set the size for in our tool tables, so if the gcode asks for a tool change it will auto change; if this was a V endmill it should show that, and cut the stock based off of that, not just following a line."

## Intent

A hobbyist should see the cut before they make it, and watch it happen while it runs: the real tool, the real shape it leaves in the stock. The current view draws a generic tool glyph and a line.

## Goals

1. **Tool shape.** The 3D tool marker is drawn from the tool table's geometry for the active tool: flat, ball, bull-nose (corner radius), V-bit and engraver (included angle, tip width), chamfer, drill (point angle), surfacing, o-flute. Diameter, flute length and shank come from `ToolGeometry` (`packages/library/src/types.ts`). Shank above the flutes, drawn plainly.
2. **Tool changes switch it.** The active tool at a line is the last `M6` with its `T` word (or `T` then `M6`, per the dialect) before that line. In the preview it follows the scrubber; in a live job it follows the executing line. The tool table maps T numbers to tools (`toolStore`, `ToolEntry.number`).
3. **Stock carving.** The stock's top is a heightmap over its footprint. Each cutting move (G1/G2/G3; rapids too, since a rapid into the stock also cuts and is worth showing) sweeps the active tool's profile through it. Preview: carve up to the scrubber line. Live job: carve up to the last executed line.
4. **Into-the-fixture warning.** Cells cut below the stock's bottom are drawn red, with one note naming the first line and the depth below the stock ("The tool goes 0.6 mm below the stock at line 812"). This uses the planned setup, so it is a planning note, never a placement certainty, and it is shown as a preview finding.

## Non-goals

- Undercuts, 4th axis, tool holder collisions, chip-load or force simulation.
- Changing anything the machine is sent. The simulation is display only and never gates a command.

## Anti-goals (failure even if it works)

- The page stutters while a job runs, or the tool marker lags because the simulation is busy.
- A guessed tool is carved as if it were real.
- The view implies the job is verified safe.
- A god module: the simulation, the tool profiles, the mesh and the renderer hooks are separate small files.

## Decisions made (owner approved the plan; these are the lead's calls)

- **2.5D heightmap**, top-down Z per cell (Float32). Cell size: 0.25 mm, coarsened so the grid stays under about 2 million cells; the chosen cell size is shown in the key ("carving at 0.25 mm").
- **Unknown tool** (T number not in the tool table, or no M6 before the first cut): no carving with a guessed size. The marker becomes a plain neutral cylinder labelled "T1 is not in your tool table", with a link "Add T1 to your tool table" that opens the tool table with that number filled in. Carving resumes from the first line whose tool is known; lines cut by an unknown tool are listed in the key.
- **Runs in a Web Worker** (alongside the existing preview worker or a sibling), in chunks with progress, so the page and the live marker stay smooth. Keyframes (heightmap snapshots, compressed or every N lines within a memory cap) make scrubbing backwards fast; scrubbing forward continues from the nearest keyframe.
- **Rendering:** the heightmap as a float texture displacing a grid mesh in WebGL2, normals from neighbouring texels in the shader, side walls to the stock bottom. Dirty rectangles are uploaded with `texSubImage2D` as the carving advances. The SVG fallback keeps its current top view (optionally shading depth); no carving there in the first slice.
- **Frames:** the carve happens in the path frame (the same frame the toolpath is drawn in), then placed by the scene's path offset, so it stays aligned with the toolpath and with the G92-aware frame fix landing in parallel (branch `g92-frame`).
- **Live job:** carve to the last line the board reports finished (the line before the executing line), not to `job.sentThrough`. Never ahead of the board.
- **Reduced motion and low-end machines:** carving is on by default in the preview; a toggle "Carve stock" in the view menu turns it off. Above the lite-mode threshold (300,000 lines) carving starts off with a one-line note.

## Tool profile

A pure function per tool type gives the tool's lower surface as height above the tip at radius r (0 ≤ r ≤ D/2), plus the radius at which it reaches full diameter:
- flat: 0
- ball: R − √(R² − r²)
- bull-nose (corner radius c): 0 for r ≤ R − c, then c − √(c² − (r − (R − c))²)
- V-bit / engraver / chamfer (included angle α, tip width w): 0 for r ≤ w/2, else (r − w/2) / tan(α/2)
- drill (point angle β): r / tan(β/2)
- surfacing, o-flute: flat (o-flute's own corner, if given, as bull-nose)

## Sweep

For each cutting segment, for each cell in the segment's XY bounding box grown by R: find the closest point on the segment's XY projection, its Z (linear along the segment), and the distance d. New height = min(old, zClosest + profile(d)) for d ≤ R. Arcs are already split into line segments by the interpreter. Plunges (pure Z) are a single stamp at the lowest point. Exact for horizontal moves; ramps are close enough and stated as such.

## Pieces (files, each small)

- `packages/gcode-view/src/toolProfile.ts`: profiles and the marker's glyph outline from `ToolGeometry`. Pure, tested.
- `packages/gcode-view/src/carve/heightmap.ts`: grid, cell size, bounds. Pure.
- `packages/gcode-view/src/carve/sweep.ts`: segment sweep. Pure, tested against hand-computed grooves (V-groove depth and width, ball channel, flat pocket floor).
- `packages/gcode-view/src/carve/keyframes.ts`: snapshot store with a memory cap.
- `packages/gcode-view/src/carve/worker.ts` and a small client: chunked carving, progress, cancel.
- `packages/gcode-view/src/carve/mesh.ts` and the renderer hook: texture upload, grid mesh, shader.
- `packages/gcode/src/…`: active tool per line as a change-point table (line → T number at each tool change), from the interpreter or a small pass beside it.
- `apps/web/src/preview/…`: active tool lookup from the tool table, the "not in your tool table" note and link, the carve toggle, the red below-stock note.

## Slices

1. Active tool per line + tool-shaped marker (preview and live), unknown-tool note and link.
2. Heightmap carving in a worker, keyframes, preview follows the scrubber.
3. Live carving during a job (to the last finished line), below-stock red cells and note.
4. Polish: cell size note, toggle, lite mode, performance on a 300k-line file.

Each slice ships with unit tests and a browser check, keeps `pnpm check`, `pnpm e2e` and fake-serial green, and is reviewed before merge.
