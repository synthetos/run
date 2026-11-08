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
- `packages/gcode-view/src/carve/mesh.ts` and the renderer hook: texture upload, grid mesh, shader (GLSL in `carve/shaders.ts`, mesh layout and walls in `carve/meshGeometry.ts`).
- `packages/gcode-view/src/carve/carver.ts`: walks the segment list to a target line, tools per change point, keyframes; `carve/protocol.ts` the worker messages.
- `packages/gcode/src/…`: active tool per line as a change-point table (line → T number at each tool change), from the interpreter or a small pass beside it.
- `apps/web/src/preview/…`: active tool lookup from the tool table, the "not in your tool table" note and link, the carve toggle, the red below-stock note.

## Slices

1. Active tool per line + tool-shaped marker (preview and live), unknown-tool note and link.
2. Heightmap carving in a worker, keyframes, preview follows the scrubber.
3. Live carving during a job (to the last finished line), below-stock red cells and note.
4. Polish: cell size note, toggle, lite mode, performance on a 300k-line file.

Each slice ships with unit tests and a browser check, keeps `pnpm check`, `pnpm e2e` and fake-serial green, and is reviewed before merge.

## Slice 2 decisions (stock carving in the preview)

- **What the preview carves to.** The scrubbed line (the last scrubbed file line, the same notion slice 1 uses for the marker). **With nothing scrubbed, the whole job is carved**, so opening a file shows the finished part. Live carving during a job (slice 3) only changes the target the hook is given (`useCarve`'s `target`).
- **Cell size.** 0.25 mm, coarsened through round sizes (0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.25 …) until the grid has at most 2,000,000 cells and at most 4,096 cells a side (a texture side every WebGL2 GPU in use supports). The key says the size used: "Carving at 0.25 mm".
- **Frame.** The grid is the scene's stock solid (already moved by the live placement when there is one) taken into the path frame by the scene's path offset, and drawn with that offset, like the path. A round or imported stock keeps its outline: cells whose centre is outside it hold "no stock" and are never carved or drawn. No scene (no job), no carving.
- **Unknown tool.** The page looks the tools up (tool table, `toolNumbered`) and sends the worker one entry per change point in sent-line indices: a shape or null. Null (no M6 before the line, M6 with no T, a T number not in the table) carves nothing. The key lists the runs of cutting lines (feeds and arcs; a rapid alone is not called a cut) that were skipped and why, for example "Lines 5–9 not carved: T9 is not in your tool table"; past three runs it counts the rest. These notes sit on the key line at the drawing's foot, not in the notes box at the top, so they never grow over the middle of a small drawing (where a click picks a part). Lines before the first M6 are carved with the tool the user chose in Analyze as "Tool already in the spindle" for those cuts (advisorState `spindleToolChoice`: one T number when every such choice agrees; none, or two that disagree, carve nothing). That is the user's statement, not a guess; without it the key says "…no tool change before them. Choose the tool already in the spindle in Analyze to carve them". The choice lasts for the open file, as the Analyze inputs do. The bundled samples (no M6, "tool already in the spindle") carve once that choice is made.
- **Uncertain moves** (the interpreter is not sure the position is what the program intends) carve nothing either, for the same reason: never draw a guess as a cut.
- **Rapids carve**, as the goals say. A move whose lowest point is at or above the stock top is skipped at once, and each sweep scans only as far from the path as the tool's profile stays below the stock top (a 1 mm deep cut with a 12.7 mm V-bit scans a 2 mm band, not 12.7 mm).
- **Sweep accuracy.** Exact for horizontal moves; on a ramp the Z is taken at the XY-closest point, which can leave up to slope × R too much at a ramp's edges. Plunges stamp once at the lowest point.
- **Worker.** A sibling of the preview worker (`apps/web/src/carve-worker/`, spawned through the same `rs-worker` Trusted Types policy); the handler, client and protocol live in gcode-view `carve/`. It carves in slices of about 12 ms, posting the changed cells (a transferred copy of the dirty rectangle) after each slice, and yields between slices through a MessageChannel hop, so a new target, tool table, stock or file is taken at once. The page keeps a copy of the heightmap and pastes each patch into it; the renderer uploads only the changed rectangles.
- **Keyframes.** A copy of the heightmap every N lines, N chosen from the file length and grid size so a whole file's snapshots fit under **128 MB** (at least every 50 lines); over the cap, every other snapshot is dropped. Scrubbing back restores the nearest keyframe at or before the line and carves forward; scrubbing forward carries on. A new file, tool table or stock starts a new session and drops them all.
- **Rendering.** R32F texture read with texelFetch at NEAREST (no float filtering needed, nothing packed). The grid mesh is drawn as one triangle strip per row, instanced, positions from the vertex and instance IDs (no vertex or index buffer). On a real GPU it has a vertex per cell up to 2048 cells a side (`MESH_MAX`; the 0.25 mm grid of a 512 mm stock), so walls follow the cells. A software renderer (SwiftShader, which the browser tests use; llvmpipe) is detected from the WebGL renderer name and gets 512 a side (`SOFTWARE_MESH_MAX`), where a vertex per cell cost about 170 ms a frame; the renderer option `carveMeshMax` sets it outright. A thinned mesh's vertex takes the lowest of the cells it stands for, so a cut never disappears. *Amended after review:* the first version capped every mesh at 512 and sampled one cell per vertex, so on the sample stock the ring pocket's walls spiked (vertices landing alternately on the top and the floor); reproduced on the ring file and confirmed by a one-vertex-per-cell build, which showed none. Even with the lowest-cell rule, a thinned mesh still zig-zags along curved walls (whether a block touches the cut changes from block to block), so software renderers see a rougher wall; real GPUs do not thin grids up to 2048 a side. Normals: a Sobel slope at each texel centre (a wall stepped cell by cell around a curve gets one steady direction), blended between the four nearest texel centres per fragment, with wrapped lighting so a wall's shade does not flicker where its direction wavers. A flat surface, top or floor, is fully lit in the stock's colour; deeper is only a little darker (15% at the stock bottom). Cells cut through to the bottom are not drawn, so the fixture or bed shows through (slice 3 adds the red below-stock cells). The flat stock solid is hidden while the carved one is drawn; clicking it still opens the stock settings. Over the carved stock's footprint the toolpath is drawn at 35% opacity (`PATH_OVER_CARVE_ALPHA`), so the carve reads through it; elsewhere it is unchanged. The SVG fallback is unchanged and does not carve.
- **Measured** (Apple Silicon laptop, headless Chromium with SwiftShader): a 50,000-line raster pocket over the sample stock (345,600 cells, 3.175 mm flat end mill) carves in about 0.1–0.2 s in the worker; scrubbing back to the middle takes 5–10 ms. Node, same carver: 50,000 lines in 0.17 s (flat 6 mm), 0.30 s (ball 6 mm), 0.21 s (12.7 mm V-bit).
- **Ball channels.** The lumps seen in the first version came from the thinned mesh and from per-triangle normals, not the sweep: a unit test sweeps a 3.175 mm ball along a sine of 0.5 mm chords and finds the trough's deepest cell in every column within the cell sampling of the ball (0.01 mm), with no bumps at chord joints. What remains, a fine ripple along a steep trough rim, is the 0.25 mm grid sampling that rim; a 0.125 mm grid (1.38 million cells on the sample stock, within the cell budget) makes it much finer. The base cell stays 0.25 mm (owner's call).
- **Test hooks.** The key's carve line carries `data-carve-cell`, `data-carved-through` (the file line carved through), `data-carve-done` and `data-carve-lowest` (the lowest top in the path frame), so browser tests never read pixels.
- **Left for slices 3 and 4.** Live carving to the last finished line; the red below-stock cells and their note; the "Carve stock" toggle and lite-mode default; a 300,000-line performance pass; whether the base cell should be finer when the cell budget allows.

