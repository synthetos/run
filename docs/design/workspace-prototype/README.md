# Clickable workspace study

Increment 2. A static design study outside the app build and the shipping
source graph. No credentials, serial permissions or board are needed, and it
never opens a port. Serve the repository on loopback:

```sh
node docs/design/workspace-prototype/prepare.mjs
python3 -m http.server 8766 --bind 127.0.0.1
```

Open <http://127.0.0.1:8766/docs/design/workspace-prototype/>. Views: `#run`,
`#setup`, `#tools`, `#configure`, `#machines`, `#projects`, `#analyze`. States:
`#disconnected`, `#identified`, `#idle`, `#outdated`, `#running`,
`#toolchange`, `#held`, `#lost`, `#orphaned` (or use the dashed Preview
picker in the header, a review tool, not a product control). Everything is
simulated and resets on reload.

What it covers: the 3D setup and preview with material removal (bed, DXF/SVG
fixture, clamps, block/round/sheet stock, eight materials), the Job card,
jog, spindle and coolant, overrides, the live job console and timeline, the
manual tool-change card, the tool library, the feeds and speeds advisor, the
machine catalogue drawings, the avatar account menu, and Board: wiring,
firmware (gate and update panel) and backups. The product spec and data model
are in [WORKSPACE_FEATURES.md](../WORKSPACE_FEATURES.md).

| File | Role |
| --- | --- |
| `index.template.html` → `index.html` | Markup. `prepare.mjs` fills W1, the W2 tooltip and W13 from `packages/safety/src/strings.ts`; `--check` detects stale copy. |
| `prototype.css` | Layout and components on the app's theme and safety tokens and self-hosted IBM Plex. |
| `prototype.mjs` | Interactions, built with DOM APIs only (no HTML sinks). |
| `telemetry.mjs` | **The seam.** Every live value comes from here. Mocked firmware features (spindle report, overrides, tool table) are tagged `mock: 'firmware pending'`. |
| `job.mjs` | Sample setup, materials, tools, the three-operation file, the advisor rules. |
| `scene.mjs` | Canvas 2D scene with a heightfield for material removal. |
| `machines.mjs` | Hidden-line blueprint drawings of the catalogue machines. |
| `capture.mjs` | Screenshots and checks with the repository's Playwright. |

Labels follow OD-6: "Pause" and "Stop job", W1 on top, and the paused state
reads "Paused · spindle still on". SAFETY.md W2 is not yet amended, so the
button label is set in the template while the tooltip stays canonical.

Capture the review set (152 screenshots: 19 views, 1280, 1440, 1920 and 390
wide, light and dark) while the server runs:

```sh
node docs/design/workspace-prototype/capture.mjs --output /absolute/path
```

Every capture checks: no document scroll; the warning, Pause and Stop visible,
enabled and labelled; Pause and Escape never fake a state; the document never
reloads; no workers, external requests, page errors or CSP violations. It also
exercises the DXF import, tool selection, motor arithmetic, backup diff,
machine copy (which never retargets the connection), the advisor and Back.
`review.html` in the output folder is the gallery.

The prototype's own CSP forbids network connections, workers, inline styles
and HTML sinks. Nothing here changes production CSP, gates or safety strings.
Serving the repository is for local review only, never deployment. Do not use
the board illustration as a wiring reference.
