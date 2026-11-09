# Place job

Owner, 2026-11-09: "this is a job sender not a cam tool… should this be in the run or cad tool?" OD-28.

## The split

- **CAM owns the toolpath and the file's zero.** Where zero is in the file was chosen when the file was made. Run never moves, mirrors or offsets the file's coordinates.
- **Run owns where that zero goes on the real stock.** Place job asks for the same point on the stock, and the preview, the margins and Run's zero check follow from it. Setting the board's work offset stays with the Offsets controls (and the user).

## What Place job does

- **Reads the file's zero** (`workspace/fileZero.ts`, `fileZeroOf.ts`). From the cutting moves' bounds (feeds and arcs; a plunge counts):
  - X/Y: low end at about 0 and running positive is the left or front; high end at about 0 is the right or back; about symmetric around 0 is the centre. A tool radius of slack is allowed; "about symmetric" within 2% is clear, within 10% is "may be".
  - Z: cuts below 0 mean the top; cuts at 0 and above mean the bottom.
  - Header notes (Fusion WCS lines and the like, the first 8 KB) back up a loose guess, or make it unclear when they disagree.
  - Anything else (cuts that start well away from 0, X centred but Y at the front) is unclear, and says "Keep your pick."
- **Pre-selects it** (`useAutoZero.ts`) for a file new to the job, when clear or likely. `placement.datumFrom` records who picked and for which file hash: a click is the user's pick for that file, and is never changed. Jobs saved before this count as the user's pick.
- **Warns when the toolpath hangs off the stock** (`placeFit.ts`) at the chosen point and another point fits, with a one-click "Use …". It checks the toolpath itself (a profile's tool edge just past the stock is normal; the margins say so), and stays quiet when the pick already is the file's zero (then the stock size is the problem, not the zero).
- **Moves zero on the stock** (`views/PlaceOffset.ts`): X/Y inward from a corner (machine directions from the centre), and the zero depth: "Zero is [ ] mm below the stock top" (or above the bottom). Positive is down from the top, up from the bottom. Saved in `placement.offset`.
- **The machine's work zero** (`liveZero.ts`): offered while connected with the machine position set. The job is drawn at the board's work zero, the margins come from it, and Run's zero check compares against it (so C31, shown for a difference, does not show). It writes nothing to the board, and the job stores only `placement.zeroFrom: 'machine'`. With no board, the plan falls back to the point on the stock and says so.

## Where it flows

`jobModel.ts` `effectiveZero(job, liveZero)` is the zero the scene (`preview/sceneModel.ts` `jobScene`), the carve and the below-stock note (from the scene), the margins and Run's zero check (`zeroPlan.ts` `setupPlan`) use. The machine-side travel check (OD-24) uses the board's actual offsets, as before.
