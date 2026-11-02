# Run workspace — implementation handoff

Increment 1, design only. Start with [the clickable study](workspace-prototype/index.html)
and [the rationale](WORKSPACE_PROPOSAL.md). The prototype has no hardware,
worker, network requests, account storage or controller writes. Its scenario
picker is a review tool, not a product control. All measurements are examples.

## Layout and components

| Region | Contents and behavior |
| --- | --- |
| Fixed warning | Canonical W1. Never removed to create more canvas space. |
| Header / context | Synthetos Run, current project, account and theme. Project context is not the connected-machine identity. |
| Fixed machine strip | Connected machine name, state, overlays, source freshness, Pause and Stop. Never unmounted, obscured by a dialog or made inert by view navigation. |
| Navigation rail | Run, Configure, Machines, Projects, Analyze; Settings and Safety are panels. Selected view has a label, icon and rule. |
| Centre | Toolpath canvas, board/machine diagram, library or project content. It gets the remaining space. |
| Right inspector | Position and operation in Run; the selected input/motor in Configure. Scrolls independently on desktop. |
| Bottom drawers | G-code, analysis, transcript. Virtualize long source/log content. No unrestricted command input in Phase 1. |
| Detail/review panel | Opens below the safety strip, contains its own scroll, preserves context and returns focus to its trigger. |

At 1280×720 and above: fixed `100dvh` shell, approximately 88 px rail,
320 px inspector (360 px on wide screens), 24 px outer inset and 18–24 px
panel gaps. Flex children use `min-height:0`; only named content regions
scroll. At 390×844: bottom navigation, one internally scrolling content stack,
full-width controls above it. Mobile is preparation/inspection; this layout
must not bypass the existing platform prohibition on machine control.

## State presentation

The five families have seven review variants. State always comes from a
controller/session snapshot, never from clicking a button.

| Family / variant | Surface and next useful action |
| --- | --- |
| Disconnected | “Not connected”; positions and offsets are “Not read” / em dashes. Projects and offline preview work. Connect remains a distinct gated action. |
| Identified, read only | “Connected · read only”; explain why operation is unavailable. Show source/age and inspect configuration. |
| Idle, configuration differs | “Machine idle” plus “Needs review”. A specific profile/controller difference opens the changeset. No automatic apply. |
| Running | Job/operation identity and progress; Pause becomes prominent. “Pause sent; waiting for controller report” does **not** change the state to Held. |
| Held | “Job held”; spindle remains explicitly unconfirmed unless independently reported. A later Resume rechecks existing safety rules. |
| Lost | “Connection lost / Not delivered”; last-known coordinates are visibly stale. Recovery card and physical E-stop guidance. No automatic reconnect/resume. |
| Orphaned motion | “Motion unconfirmed”; positions are untrusted, operation blocked. Keep Pause/Stop and recovery guidance reachable. |

Running/held are later-phase design examples, not new Phase 1 capabilities.
Pause and Stop remain enabled and reachable in every prototype view. In the
product, a disconnected click reports non-delivery; idle controls are quiet,
not gated. Delivery status and machine state are separate fields. Escape
retains capture-phase Pause behavior while also dismissing a panel. Neither
cloud failure, expiry, a modal, nor an expensive preview may block stops.
W1/W2/W13 copy comes from canonical safety strings, not hand-edited UI copy.

## Configuration interaction

Start with Board and Machine perspectives over the same draft. Board view
uses a revision-matched public illustration with data-defined hotspots;
Machine view will explain physical axes, motors and mechanisms. The study's
TinyG v8 drawing is a separately authored layout concept. OD-5 permits that
approach; connector positions, names and pin mappings still need definition
verification before use as wiring instructions. No private CAD, netlists,
images or source files are published; only reviewed derived facts (D26).

X-min: select the connector → choose function → choose NO/NC → see the
contact illustration and **all eight affected inputs** → save to draft →
review the shared change. “Not read” is distinct from Disabled. The diagram
must never imply that shared polarity affects only the selected input.

Motor: select a port → assign axis → record frame/nameplate current → step
angle → microsteps → mechanism travel/revolution. Explain the relationship:
`(360 / step angle) × microsteps / travel = steps/mm`. This is an estimate,
not calibration. Frame does not determine current; current on this board is
adjusted physically. Zero/negative travel and recorded current refuse Save.

Each connector has an in-memory working proposal. Switching inspectors keeps
it; Save updates one keyed draft entry, never duplicates it. Review combines
all saved entries, the controller snapshot or “Not read”, shared effects and
unverified facts. Clearing the draft affects no controller state. The product
will need an explicit discard warning for unsaved work and revision conflict
handling. Phase 1 has **no Apply button**. Later application uses one reviewed,
ordered changeset through the existing allow-matrix and confirmations, followed
by verified reads; it is not a sequence of immediate form-field writes.

“Editing Router B; connected to Router A” must be visible whenever those
identities differ. Selecting or forking a profile cannot retarget the session.

## Machines, projects and analysis

A library entry is a versioned, sourced template; a user's machine is a private
fork; the last controller read is a third, separate snapshot. Updates present
three-way differences. Never inherit homing, commissioning or safety approval.
Start with a small verified catalogue and first-class Custom, not guessed
settings for every commercial machine. Sharing follows a later reviewed policy.

Projects contain immutable file versions, operations, notes and job history.
Cloud sync supplies project/profile data only. It cannot restore a LIVE session,
homing fact or resume permission. Local draft creation works before cloud sync;
the UI must state what is stored locally and what actually synced.

Analyze has a permanent home beside the preview. Source-line selection maps to
geometry and diagnostics. An optimization makes a new candidate version for
comparison and preflight; it never rewrites an armed or running job. Sent,
acknowledged and executed progress remain distinct.

## Tokens and visual rules

Use the existing `apps/web/src/styles/tokens.css` and self-hosted Plex fonts.

| Tokens | Role |
| --- | --- |
| `--paper`, `--sheet`, `--ink`, `--muted` | Workspace, panels, primary and secondary copy. |
| `--rule`, `--grid`, `--field` | Thin dividers, canvas grid, field boundaries. Grid belongs on diagrams, not every surface. |
| `--blue`, `--blue-dk`, `--blue-wash`, `--on-blue` | Selection, navigation and ordinary actions. |
| `--sans`, `--cond`, `--mono` | Plex body, compact headings, tabular coordinates/raw keys. |
| `--state-run`, `--state-hold`, `--state-alarm`, `--live`, `--warn` | State accents paired with text, never color alone. |
| `--bar-*`, `--stop-*`, `--on-stop`, `--hazard-*` | Production safety appearance. Retain its independent contrast gates. |

Use 4 px base spacing, 4–6 px corners, mostly 1 px rules. Avoid dashboard
ornament and fabricated precision. Focus rings are visible in both themes.
The prototype's compact cream W1 surface is a design proposal only: adopting
it requires safety-color review; it does not authorize changing production
safety tokens or contrast requirements.

## Architecture and acceptance

One document-lifetime session owner sits above routes. It owns the worker,
connection, subscription and stop bridge. Views only subscribe and issue typed
intents; view cleanup never closes the worker. Route failures are contained to
that view. Use a literal lazy-import map, explicit deep-link routes and existing
CSP/Trusted Types boundaries. Cold deep links start disconnected. `/safety/`
remains prerenderable but in-app navigation does not reload it. Retain old assets
for open sessions; updates and sign-in must not silently reload a LIVE document.
No SharedWorker is introduced by this design.

Acceptance for the implementation: one worker/session/transport-open count
across every view and Back/Forward; no document scroll at all four review sizes;
Pause/Stop reachable through panels and auth failure; unknown ≠ zero; state not
optimistically changed by command delivery; no raw ports in view code; existing
layering, serial-chunk, CSP/TT and canonical-string gates remain unchanged.
