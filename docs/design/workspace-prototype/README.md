# Clickable workspace study

Increment 1 only. Open the prototype through a loopback static server rooted at
this repository. No app build, credentials, serial permissions or board is needed.

```sh
node docs/design/workspace-prototype/prepare.mjs
python3 -m http.server 8766 --bind 127.0.0.1
```

Open <http://127.0.0.1:8766/docs/design/workspace-prototype/>.
Use `#run`, `#loaded`, `#configure`, `#machines`, `#projects`, or `#analyze`
for review entry points. Navigation inside the prototype preserves its document.
The state is simulated and all edits reset on reload. Do not use the board
illustration as a wiring reference.

The theme and self-hosted fonts are the existing app assets. `prepare.mjs`
generates `index.html` from its template using canonical W1, W2 and W13 strings;
`--check` detects stale generated copy. On-screen SVG is authored from the public
TinyG v8 reference, with no private board assets. See
[the proposal](../WORKSPACE_PROPOSAL.md) for scope, rationale and review questions.

The prototype is outside the Vite inputs and shipping source graph. Its own CSP
forbids network connections, workers, HTML/script sinks and third-party assets.
It does not change production CSP or any gate exception. Serving the repository
is for local review only, never deployment.

Capture 40 review screenshots and check interactions with Python Playwright:

```sh
python capture.py --output /absolute/path/to/screenshots
```

Run that command from this directory while the loopback server above is running.
The harness records viewport bounds, fixed safety controls, unchanged document
identity, drafts, machine copies, project loading, Back, and Pause/Escape in a
panel. It refuses off-origin requests and checks browser errors, CSP violations
and worker absence. Captures: 1280×720, 1440×900, 1920×1080, 390×844, light/dark,
for idle, file-loaded, Configure, Machines and Projects.

The editor panel is deliberately modeless: it sits below the persistent safety
strip and does not make Stop/Pause inert. In the prototype Escape shows simulated
Pause feedback and closes the panel. Real controller delivery semantics are not
implemented here.
