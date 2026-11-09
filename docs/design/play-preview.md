# Play preview

Owner, 2026-11-09: "play preview should just play the gcode and the movements". SAFETY H15 and T-S41 amended; OD-25; T-S141 to T-S143.

## What it is

- Play moves a preview tool along the file's moves at the programmed speeds: F for feeds and arcs, the machine profile's rapid rate (the slower of X and Y), else a stated 5,000 mm/min, for rapids. A feed before any F plays at 1,000 mm/min (the file check flags it). Acceleration, junctions and the planner are not modelled.
- 1×, 2×, 5× and 10×, starting at 1×. Pause and the scrubber work at any time; the scrubber, the highlight and the carve follow the lines done. It stops at the end; Play there starts again. End preview ends the session.
- For the whole session (playing or paused part way) the drawing says "Preview at programmed speeds: not timed like the machine".
- The preview tool is its own marker in the highlight colour. The live marker keeps its own colour and moves only on reported positions; both may show at once with an idle board.
- Offered only with a drawn file (not lite mode), never while a job of this tab owns the machine, never while the board is in motion or holds motion (JOGGING, HOMING, HELD, STOPPING_JOB, PREAMBLE, RUNNING, PROGRAM_PAUSED, ORPHANED_MOTION). A running preview stops the moment that changes. The TB-03 sheet has no Play.
- Reduced motion: Play does not run on its own; "Next move" steps one move at a time.

## Pieces

- gcode `interpreter.ts`: `lineFeeds`, the programmed feed per sent line (mm/min), carried to the page as `PreviewResult.feeds` (empty in lite mode).
- gcode-view `play/timing.ts`: the timing provider seam. `programmedTiming(lineFeeds, rapid)` gives a duration per segment. Analyze's predicted speeds (later) will be another provider; nothing else changes, and the notice should then name it.
- gcode-view `play/timeline.ts`: the time at each vertex and where the tool is at a time.
- gcode-view `play/player.ts`: the clock (playing, speed, time, seek), from a clock it is given.
- gcode-view `renderer.ts`: `setPlayMarker(position)`, a second marker drawn in the highlight colour. The renderer runs no clock of its own for it.
- apps/web `preview/usePlay.ts` (the hook: frames, the feed to the drawing, lines done to the page), `PlayControls.ts` (the buttons and the notice), `playAllowed.ts` (when it may be offered, the rapid rate).
