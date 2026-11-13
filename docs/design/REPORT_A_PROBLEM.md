# Reports from inside run: problems, ideas, tool requests and questions

Owner direction:
- 2026-11-02: "support open an issue / report a bug. Since it's all backed by GitHub, we know the board (TinyG) and branch, so we could
  pre-populate opening bugs in GitHub right from the UI … attach G-code files."
- 2026-11-13: one framework where users request features, report bugs and request catalog tools from inside run, all going to issues on
  the run repo, tagged; each kind gets its own form ("request a tool" is like Add a tool; a bug asks what you were doing, with optional
  G-code, and run attaches the TinyG data and settings). "lets keep the code clean."
- 2026-11-13: questions should post to the forum on the user's behalf and show a link to the new discussion, not "open the forum and copy".

Status: Phase A (below, §9) is built: `apps/web/src/report/`. This document is the design for Phase B. Nothing in Phase B is built yet.

## 1. Principles

1. **The user decides what gets posted, and sees it first.** Every collected item has its own checkbox and a preview. Redaction runs
   before the preview, so the preview is exactly what is sent.
2. **Reporting never touches the machine.** run uses only what it already holds. It sends no board commands by itself, never takes the
   connection, and never gets in the way of Pause or Stop job. The one exception is an explicit "Read settings now" button (§5), which
   uses the existing settings read, and only when the machine is idle.
3. **One window, many kinds.** A kind is a small module in a registry. Adding a kind adds a file; the window, collectors and sending
   don't change.
4. **No outside origins in the page.** The page posts only to run's own Worker (same origin). The Worker talks to GitHub and the forum.
   This keeps the bundle scan (T-S40) strict; Phase B removes the GitHub and forum URLs from the page in stages (§12).
5. **One Synthetos identity.** Sending needs the user's Synthetos account (accounts.synthetos.com). No new sign-in path, no new
   GitHub OAuth app for users.
6. **Modular, no god files.** Each layer below is its own small module.

## 2. Kinds

| Kind | Started from | Fields the user fills | Collected items offered | Goes to | Labels |
|---|---|---|---|---|---|
| `problem` | Account menu "Report a problem"; notice "Report this"; G-code line; Board finding; Console | Title. What were you doing (checkboxes, each one label: Connecting `area: connection`, Settings `area: settings`, Firmware did something wrong `area: firmware`, Firmware update `area: firmware-update`, Preview `area: preview`, Running a job `area: job`, Library `area: library`, Other: no area label). What happened. What you expected. | environment, board, event, transcript, settings, gcode, screenshot (§5) | `synthetos/run` issue | `bug`, `from-run`, one `area: …` per checked box |
| `idea` | Account menu "Suggest an idea" | Title. What you want. Why it helps you. | environment | `synthetos/run` issue | `enhancement`, `from-run` |
| `tool-request` | Tool catalog "Request a tool" (search text pre-fills) | Product page link (required, http/https only). Maker. Part number. Then the Add a tool fields, all optional (type, diameter, flutes, cut length, shank, material, coating). Optional note. | none | `synthetos/run` issue | `catalog: tool request`, `from-run` |
| `question` | Account menu "Ask a question"; the triage step | What is it about (Run app, TinyG firmware, Board hardware, CNC in general). Your question (title). Details. What you've tried (optional). | environment, board (both off by default, §5) | forum discussion in the matching category | — |
| `catalog-correction` (phase B2) | A catalog tool's window "Report wrong data" | Which value is wrong. What it should be. Source link. | the tool's catalog id and revision | `synthetos/run` issue | `catalog: correction`, `from-run` |

Firmware problems are `problem` reports with the "Firmware did something wrong" box (`area: firmware`); they go to `synthetos/run` with that label and a maintainer
transfers them to the firmware repo when needed (owner: "all goes to issues on the run repo"). Phase A's direct firmware-repo targets go away.

A kind module exports one object:

```ts
interface ReportKind<F> {
  id: 'problem' | 'idea' | 'tool-request' | 'question' | 'catalog-correction';
  title: string;                      // shown in the triage step
  destination: 'issue' | 'forum';
  fields: FieldSpec[];                // drives the generic form renderer and both validators
  items: ItemId[];                    // collected items this kind may offer
  defaults: Partial<Record<ItemId, boolean>>;
  labels(f: F): string[];             // issue labels (fixed allowlist, §6)
  title(f: F): string;                // issue or discussion title
  prefill(ctx: ReportContext): Partial<F>;
}
```

The shared package owns the types, field specs, validation and label allowlist. The page renders from `fields`; a kind may add one small
custom component when the generic renderer is not enough (`tool-request` reuses the Add a tool field components, not a copy of them).

## 3. The window

One non-modal panel (as Phase A: it covers the views below the machine strip, so Pause and Stop job stay visible and clickable).
It uses the shared `useDialogDismiss` hook; it never stops Escape from reaching the pause handler (T-S18).

1. **Kind** (skipped when an entry point names it).
2. **Your words:** the kind's fields.
3. **What's included:** each collected item with a checkbox and preview, under the line "Everything you send is public: anyone can read and download it."
4. **Send.** A typed draft is kept in the browser until it is sent or discarded; the unsaved-changes prompt applies.
5. **Done:** "Report #123 sent" with a link to the issue, or "Question posted" with a link to the discussion. A held question (forum
   premoderation) says "Your question is waiting for a moderator" with no link.

Signed out: steps 1–3 work; Send is replaced by "Sign in to send" and "Copy report". The draft survives the sign-in round trip.

Entry points call one function: `openReport({ kind, context })`. `context` carries what the user was looking at (view, notice event,
G-code line, catalog search text, catalog tool id).

## 4. Everything sent is public (owner decision 2026-11-13)

Owner: "it can be public the customer chooses whether or not to attach a gcode file."

The run repo and the forum are public, and so is everything a report sends. The user's protection is the choice itself: each collected
item has its own checkbox and preview (§5), the window says plainly that anyone can read and download what is sent, and the redaction
(board id, no full user-agent, no IP) runs before the preview.

| Part | Where it lives |
|---|---|
| The user's words, title, labels | The issue or discussion |
| Short facts: run version and commit, browser and OS family, board fb/fv/hv and dialect, the alarm code and message | A collapsed block in the issue |
| Settings and transcript | Inline in collapsed blocks when each is under 20 kB; otherwise the first 20 kB inline plus a link to the whole file (§7) |
| G-code (excerpt or whole file), screenshot | Always a link to the file (§7); the excerpt is also inline |
| `question` kind | Only the words and, if the user ticked them, the short facts; no files |

The whole-file G-code consent step keeps Phase A's wording: "Upload the whole G-code file to this issue? Issues are public: anyone can
read and download it." with **Upload the whole file** / **Only 25 lines around the problem**. It is asked every time, never remembered,
and the default is the excerpt.

## 5. Collected items

Reused from Phase A (`report/collect.ts`, `items.ts`, `redact.ts`), as a registry of collectors. Each returns
`{ id, title, preview, payload, defaultOn }`.

| Item | Default | Notes |
|---|---|---|
| environment | on | No full user-agent, no IP |
| board facts | on (`problem`), off (`question`) | Board id redacted |
| event context | on when started from a notice | Code, message, state history, line being executed |
| transcript | on (`problem`) | Last 200 lines around the event, board id redacted |
| settings | on (`problem`) | The backup format; cached values only. If never read this session and the machine is connected, idle (no job, not alarmed) and holds no motion, a "Read settings now" button runs the existing Board view settings read. Disabled otherwise, with the reason. |
| gcode | excerpt on; whole file needs consent | File name and comments shown before sending |
| screenshot | off | 3D preview canvas only |

## 6. Sending (run Worker)

`POST /api/reports` on `workers/run` (same origin). Body: `{ submissionId, kind, fields, items: { id, payload }[] }`.

1. Session check (run's accounts session). 401 → the page shows "Sign in to send".
2. Validate with the shared package: kind exists, fields match the spec, sizes within limits (title ≤ 120, each text ≤ 8000, whole
   request ≤ 5 MB, G-code ≤ 4 MB). The Worker never accepts Markdown from the page; it renders the issue text itself from fields,
   escaping `@` mentions, `#` issue references and HTML. Labels come only from the kind's allowlist.
3. Limits per account: 5 reports per hour, 20 per day (D1 counter). 429 → "You have sent several reports recently. Try again later."
4. Idempotency: `submissionId` (client UUID) is unique per account; a retry returns the first result.
5. Files → report storage (§7); the issue links each one: "G-code: mounting-plate.nc (120 kB)".
6. Destination:
   - `issue`: create the issue on `synthetos/run` with the "Synthetos Reports" GitHub App installation token (issues: write on that one
     repo; a new, separate app, not the user sign-in app). The body ends with "Reported from run by <handle>". The handle is the account's GitHub login. It is a live
     `@` mention only when the user ticked "Mention me so GitHub tells me about replies" (on by default, shown in step 3); otherwise it is
     written without the `@`. This footer is the only `@` the Worker ever emits. Return `{ number, url }`.
   - `forum`: §8.
7. Record the report in D1 (account id, kind, destination number/url, submissionId, created). Nothing else about the user is stored.

`tool-request` duplicates: the Worker normalises maker + part number; if an open request exists, it adds a comment "Also requested
from run" (counted, not one comment per user after the first few) and returns that issue, with the page saying "Already requested:
we added your vote to #123."

## 7. Report file storage

GitHub's API cannot attach files to an issue, so run stores them. R2 bucket `run-reports` (separate from user files), keys
`reports/<opaque id>/<file name>`. The files are public, like the issue: `GET /reports/<opaque id>/<file name>` on the run Worker serves
them with `Content-Disposition: attachment`, `text/plain` or the image type, and `X-Content-Type-Options: nosniff`, never as a page.
Files are kept while the issue exists. Staff can delete a report's files (a staff-only `DELETE` route) when a user asks. Staff are a list of account subjects in run's
configuration (`REPORT_STAFF_SUBJECTS`, a CI secret), the same pattern as the run access allowlist; accounts gets no role system for this.

## 8. Questions to the forum, posted as the user

forumbot already posts discussions as the signed-in user (`POST api/v1/discussions`, `src/routes/ask.ts`), using the user's own GitHub
token that forumbot holds. run must not hold forum posting tokens or call GitHub Discussions itself. So run asks forumbot to post:

**Prerequisite (already approved, not built):** forumbot signs users in through accounts.synthetos.com (forumbot's planned
`oidc:<name>` provider), so a run user and a forum user are the same account.

**forumbot addition (generic, for any tenant's relying parties):** a server-to-server endpoint, for example
`POST api/v1/relying-party/discussions`, that:
- authenticates the calling product (run's Worker) with a per-relying-party credential issued by the tenant config, and the user with
  an accounts-issued token for that user, audience forumbot;
- runs the same pipeline as `api/v1/discussions` from step 4 on (membership, ban, allowlist, category, validation, limits,
  premoderation, idempotency, the user's posting token, createDiscussion);
- where the normal path would ask for Turnstile (trust level 0), returns `needs_forum_step` instead, and run shows
  "Finish posting on the forum" with the text copied (the Phase A fallback, once);
- where the user has never authorised forum posting, returns `needs_forum_authorization`, and run shows
  "Allow the forum to post for you" (one visit to the forum, then retry);
- returns `{ number, url }`, or `202 { held }` for premoderation.

**Proving who the user is (my call, settle in the B3 plan):** accounts today supports only the code flow, one audience per client and
no token exchange, so it cannot yet mint a forumbot-audience token from a run session. Preferred: accounts adds a narrow token exchange
(a live run session for a five-minute token, audience forumbot, scope "post discussion"), so forumbot never has to trust run to name any
user. Fallback if that is refused: forumbot trusts run's relying-party credential to vouch for a `sub`, limited to creating discussions,
only for users who have signed in to the forum and allowed posting, rate-limited and logged with the relying party's name. Either way
it is listed as a B3 dependency.

The category for each "What is it about" choice comes from the tenant's category slugs (configuration, not code in run).

## 9. Phase A (built today) and what changes

Phase A: triage → write-up and items → a pre-filled GitHub issue link opened in a new tab (`noopener`), "Download report files" (zip)
and "Copy report"; questions open the forum's new-discussion form and copy the text. Destinations are an allowlist in `report/targets.ts`,
admitted by the bundle scan.

Phase B:
- Send goes through `/api/reports`; the GitHub URLs leave the page once every environment sends that way, and the forum URL after B3 (§12).
- "Copy report" and "Download report files" stay as the signed-out and failure fallback.
- `KINDS` in `ReportDialog.ts` becomes the kind registry; the dialog splits into the window shell, the generic field renderer and the
  per-kind components.

## 10. Module layout

| Module | Contents |
|---|---|
| `packages/reports` (new) | Kind types and registry data, field specs, validation, label allowlist, size limits, issue-text renderer, normaliser for tool requests. Pure; used by the page and the Worker. |
| `apps/web/src/report/` | Window shell, field renderer, per-kind components, collectors (existing), redaction (existing), client for `/api/reports`, draft storage. |
| `workers/run/src/reports/` | Route, session check, limits, idempotency, GitHub issue client (app token), forumbot client. One file each. |
| `workers/run-data` | The `reports` and `report_limits` tables and the `run-reports` bucket, behind new RPC methods on its `AppEntrypoint`, the same way records work. run keeps only its current bindings (ACCOUNTS, RUN_DATA, RUN_AUTH), so the binding gates do not change. |
| forumbot `src/routes/relying-party.ts` (+ identity) | §8, generic. |

## 11. Infrastructure

Provisioned by CI (no manual Cloudflare steps): R2 bucket `run-reports` with its lifecycle rule, D1 tables `reports` and
`report_limits` (run-data migrations), Worker secrets for the GitHub App id, its private key and installation id, and the forumbot
relying-party credential.

Owner one-time steps outside Cloudflare: create the "Synthetos Reports" GitHub App (issues: read and write on `synthetos/run` only, no
webhooks), install it on `synthetos/run`, store its private key as a GitHub Actions secret for CI; approve creating the labels in §2
on the public repo.

## 12. Order of work

| Phase | Contents | Depends on |
|---|---|---|
| B1 | `packages/reports`, kind registry, window refactor, `problem` / `idea` / `tool-request`, `/api/reports` to issues, report files, limits | GitHub App, labels |
| B2 | `tool-request` duplicates and votes, `catalog-correction`, "Your reports" list in the account menu | B1 |
| B3 | `question` posted as the user | forumbot accounts sign-in, accounts token exchange (or the fallback in §8), forumbot relying-party endpoint |

Until B3 ships, `question` keeps Phase A's behaviour, with its own fields (§2) instead of "what happened", so the forum URL stays in
`targets.ts` and the scan's allowlist until B3.

**Environments.** Sending needs sign-in, and today only staging has it. B1 is switched on per environment: on staging Send uses
`/api/reports`; on production the Phase A GitHub link stays until production sign-in goes live. The GitHub URLs leave `targets.ts` and
the scan's allowlist only after production sends through `/api/reports`.

## 13. Tests

- Shared package: every kind's validation (good, missing, too long, bad URL), label allowlist, issue-text escaping (`@`, `#`, HTML),
  tool-request normaliser.
- Worker: signed out 401, limits 429, idempotent retry, file written and served only as a download (never as a page), staff-only delete, GitHub client
  error paths (no partial issue left without a D1 record, retry safe), forumbot error mapping (`needs_forum_step`,
  `needs_forum_authorization`, held).
- Page: each kind's form, the public notice and whole-file consent, "Read settings now" disabled while running or alarmed, Escape still pauses with the
  window open, signed-out fallback, draft survives sign-in.
- Bundle scan: no GitHub origin left once production sends through `/api/reports`; no forum origin after B3.

## 14. Security notes

- No tokens, cookies or storage contents are ever collected. Board ids are redacted before the preview.
- The Worker renders all public text itself; the page cannot inject Markdown, mentions or labels.
- Reports are always started by the user; run never files anything by itself.
