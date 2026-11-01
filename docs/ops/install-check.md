# Manual install check (ROADMAP P0-05, D38)

Playwright proves that Chrome parses the manifest without errors and reports
no installability errors (`tools/e2e/specs/install.e2e.ts`), and that nothing
on the page depends on `display-mode`. Chromium cannot emulate an installed
window, so the owner records this check by hand on desktop Chrome and Edge,
once per release candidate, against staging (or `pnpm e2e`'s `wrangler dev`
at `http://127.0.0.1:8790`, which counts as a secure origin).

Steps:
1. Open the workspace. Confirm the address bar shows the Install icon (Chrome)
   or "App available" (Edge).
2. Install. Confirm the app opens in its own window titled "Synthetos Run".
3. In the app window: the safety bar shows W1, "NOT CONNECTED", the version
   chip (same text as in the tab) and the disabled pause button.
4. Close the app window and reopen it from the dock / Start menu. Same result.
5. Uninstall.

| Date | Browser and version | OS | Version chip | Steps 1–5 pass | By |
|---|---|---|---|---|---|
| | Chrome | | | | |
| | Edge | | | | |
