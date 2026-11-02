# Report a problem: issues from inside run

The owner's direction (2026-11-02): "support open an issue / report a bug. Since it's all backed by GitHub, we know the board (TinyG) and branch, so we could pre-populate opening bugs in GitHub right from the UI … attach G-code files."

## 1. Principles

1. **The user decides what gets posted.** A GitHub issue is public. Every piece of collected data is shown before it is posted, can be switched off on its own, and is redacted by default where it identifies a person or a board.
2. **Reporting never touches the machine.** run collects only what it already holds: the session log, transcript, snapshot, settings already read, and the loaded file. Reporting sends no extra board commands, never takes the connection, and never gets in the way of Pause or Stop. It is available while a job runs, using cached data.
3. **Questions go to the forum, bugs go to issues.** The first step asks what kind of problem it is, so the issue trackers don't fill with "how do I…".
4. **Tenet 1:** GitHub opens in a new tab, and the workspace never navigates away.
5. **No duplicates if we can help it.** Before filing, the user sees similar open issues and forum threads.

## 2. Entry points

- The account menu, and Safety → "Report a problem".
- **Context buttons that pre-fill the report:**
  - the notice for an alarm, fault, ORPHANED_MOTION or unexpected response: "Report this";
  - a G-code line: "Report a problem with this line";
  - a Board view finding: "Report a firmware problem";
  - the Console: "Report from here".

## 3. Where it goes (triage)

| The user picks | Destination | Pre-filled facts |
|---|---|---|
| "run isn't working right" | `synthetos/run` issues (owner decision: the public repo doesn't exist yet; until it does, the forum) | run version and commit, build channel, browser and OS (coarse), view, session state |
| "The firmware did something wrong" | `synthetos/TinyG` (dialect tinyg-en / tinyg-tg) or `synthetos/g2core` | Reported fb, fv, hp, hv and fbs; the dialect, meaning the branch (edge-next for tinyg-en, master 440.xx for tinyg-tg), and whether the build matches run's pinned commit ("fb 450.01, matches run's edge-next pin 6ec70652"). The alarm or error code with its text, the stat at the time, and the line being executed |
| "I have a question / not sure" | The forum: a new discussion in the right category, pre-filled | The same facts, as a collapsed block |
| Hardware (a board fault) | The forum, or support contact. Hardware repos are private | Board hardware version, and symptoms only |

## 4. What gets collected (each item has its own checkbox and preview)

| Item | Default | Redaction |
|---|---|---|
| Summary, steps, expected and actual (typed by the user) | required | — |
| Environment: run version, commit, channel, browser and OS family | on | No full user-agent string, no IP |
| Board facts (fb, fv, hv, dialect, approval state) | on | Board `id` replaced with `0X0000-XXX`, as in B-PROBE-1 |
| Event context: code, message, state history and overlays, the line being executed | on, when started from an event | — |
| Recent transcript (the last 200 lines around the event) | on | Board id redacted; the user can trim it |
| Settings (the backup format) | off; offer "only settings that differ from defaults" | id redacted |
| G-code | The ±25-line excerpt by default. The whole file only after an explicit consent step: "Upload the whole G-code file to this issue? Issues are public: anyone can read and download it." with **Upload the whole file** / **Only 25 lines around the problem**. The default button is the excerpt, and the choice is asked every time, never remembered | The file name and comments are shown before posting, because they may name customers or parts |
| Screenshot of the 3D preview (canvas only) | off | — |

## 5. How it is filed

**Phase A (now: no sign-in, no server).**
- run builds a pre-filled GitHub URL: `issues/new?template=<form>&title=…&<field-id>=…`. GitHub issue forms accept field values by id; the forms must exist in each repo (owner and maintainer decision).
- Diagnostics go in a collapsed `<details>` block, kept under the URL size limit (about 8 kB). Anything larger is truncated, with a note.
- Attachments can't be sent through a URL. run offers **"Download report files"**: one zip with the G-code, transcript and settings JSON, which the user drags into the issue.
- **"Copy report"** puts Markdown on the clipboard as a fallback.
- The URL opens in a new tab with `noopener`. run only learns the result if the user pastes the issue link back, which is optional.

**Phase B (with accounts and cloud).**
- **File as the user:** run files through our Worker using the user's GitHub sign-in (a GitHub App user token with issues: write on the Synthetos repos). The issue is created as them, and no token ever reaches the browser.
- **Attachments:** either a secret gist in the user's own account, which needs the gist permission and the user's consent, or a file in our storage behind an unguessable link, labelled public. Owner decision.
- **Duplicates:** we search for duplicates first (GitHub search plus forum search, through the Worker), showing "Similar issues", with 👍 instead of a new issue.
- **Your issues:** the forum account page and run's account menu list "Your reports" with their status, which links back to GitHub and the forum.

## 6. Security

- Repository targets are a fixed allowlist in code, and URLs are built with `encodeURIComponent` only. The bundle-scan gate needs a reviewed entry for `https://github.com/synthetos/…`.
- No tokens, cookies or storage contents are ever included. The redaction runs before the preview, so the preview shows exactly what gets posted.
- Reports are always started by the user. run never files anything by itself.

## 7. Owner and maintainer decisions

1. Create the public `synthetos/run` repo for run issues, or send run problems to the forum until it exists.
2. Issue forms (bug.yml with field ids) in `synthetos/TinyG` and `synthetos/g2core`, and labels such as `from-run`. Repo owner or maintainer approval.
3. Phase B attachment hosting: a gist in the user's account, or our storage.
