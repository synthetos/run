# Job Page Cleanup and GitHub Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Job page's top "No file open" bar and the repeated reassurance copy (spec §7), and show the signed-in user's GitHub avatar in the top-right account button through a same-origin Worker route.

**Architecture:** The file controls the bar carried (picker, file name, Close job, Save to project) move into the step 3 "Open & place job" panel as a small file block; the identity line, the Files drawer and the Open project button go. The run Worker gains `GET /api/avatar`: a validated run session, the GitHub identity id from that session, a server-side fetch of `avatars.githubusercontent.com` capped and type-checked, cached per id for a day, served same-origin. The web account menu renders `<img src="/api/avatar">` inside the existing round avatar span when signed in and falls back to the cloud icon on error.

**Tech Stack:** Preact `h()` views, Vitest unit tests (`apps/web/test/tree.ts` helpers), Cloudflare Worker (`workers/run`), Playwright e2e (`tools/e2e`).

**Spec:** `docs/superpowers/specs/2026-11-16-first-run-design.md` §7, plus the lead's brief of 2026-11-18 (Part B: avatar).

## Global Constraints

- Files ≤400 lines, functions ≤80 lines, complexity ≤15, ≤4 params; `tools/gates/modularity-baseline.json` only shrinks.
- Page CSP is `img-src 'self' data: blob:`; no other-origin URL in app JS. The browser never talks to GitHub.
- Every Worker response goes through the header seam in `workers/run/src/index.ts`; routes never build security headers.
- Worker `scheme://` literals must be listed in `tools/gates/src/source/workerUpstreams.ts` by file and exact text.
- No reassurance or filler copy; the account menu's sync row ("Saved to your account" / "Saved in this browser") stays: it is state.
- Edit files with Edit/Write only. Commits: plain imperative, no AI attribution.
- Targeted tests only (single vitest files, single Playwright specs); never the full gates.

## Review Focus

1. A signed-in session whose GitHub identity id is not a plain number (empty, letters, path characters): the route answers 404 and never builds a URL from it. Test in Task 5.
2. An upstream that answers 302 (GitHub redirects for missing avatars): with `redirect: 'manual'` the status is 302, not 200, so 404. Test in Task 5.
3. A cached avatar for user A must never be served to user B: the cache key is the GitHub id, and the response is `private` with `vary: Cookie`. Test in Task 5 (two sessions, two ids, two fetches).
4. The job's hidden file input (`[data-preview="file"]`) must still exist for the viewer's "Open a file" button, which clicks it by selector. Test in Task 2 (unit: the block renders the input) and the e2e specs that open files.
5. A draft job with a file open still offers Save to project; a project job shows its project name. Test in Task 2.

---

### Task 1: Text sweep: footer, menu foot, account notice, setup fine print, step 4 hint

**Files:**
- Modify: `apps/web/src/workspace/AppShell.ts:284-290` (footer)
- Modify: `apps/web/src/workspace/AccountMenu.ts:25,81` (MENU_FOOT)
- Modify: `apps/web/src/live/accountNotice.ts:17,32` (ACCOUNT_STOPS)
- Modify: `apps/web/src/workspace/views/SetupView.ts:132` (fine print)
- Modify: `apps/web/src/projects/ProjectsView.ts:70` ("Saved in this browser." sentence)
- Modify: `apps/web/src/workspace/views/run/steps.ts:34-36` (`checkStatus`)
- Modify: `apps/web/src/styles/workspace.css` (`.footer-secondary` rule if present)
- Modify: `tools/gates/modularity-baseline.json` (SetupView entries shrink if lint reports it)
- Test: `apps/web/test/jobPageText.test.ts` (new)

**Interfaces:**
- Produces: `checkStatus` returns `'Review the safety verdict'` when no file is open (unchanged otherwise). `MENU_FOOT` and `ACCOUNT_STOPS` no longer exist.

- [ ] **Step 1: Write the failing test** `apps/web/test/jobPageText.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { AccountMenuView } from '../src/workspace/AccountMenu.ts';
import { AccountNotice } from '../src/live/accountNotice.ts';
import { stepStatus } from '../src/workspace/views/run/steps.ts';
import { root, text } from './tree.ts';

const signedOut = { status: 'signed-out' as const, display: null, signIn: true, message: null };
const menu = (state = signedOut) => root(h(AccountMenuView, { state, open: true, live: false, onToggle: () => undefined, onSignOut: () => undefined, onReport: () => undefined }));

describe('job page text sweep (spec §7)', () => {
  it('the account menu keeps the sync row and drops the stop-controls reassurance', () => {
    const t = text(menu());
    expect(t).toContain('Saved in this browser');
    expect(t).not.toContain('never need');
  });
  it('the account notice has no "never need an account" line', () => {
    expect(text(root(h(AccountNotice, {})))).not.toContain('never need an account');
  });
  it('step 4 hints what Check does when no file is open', () => {
    const parts = { state: { status: 'idle', ready: true, fileName: null } } as never;
    expect(stepStatus('check', parts, null)).toBe('Review the safety verdict');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**: `cd apps/web && pnpm exec vitest run test/jobPageText.test.ts` → FAIL on "never need" and 'Open a file'.
- [ ] **Step 3: Implement**: delete `MENU_FOOT` and its `<p>`; delete `ACCOUNT_STOPS` and its `<p>`; footer keeps only the version span; SetupView line 132 becomes `jobSaved.value ? null : h('p', { class: 'fine tone-warn' }, 'Not saved: this browser blocks storage. Changes last for this page only.')`; ProjectsView empty panel text `'Create a project and add files or photos.'`; `checkStatus` no-file branch `'Review the safety verdict'`. Remove a `.footer-secondary` CSS rule if one exists. Check `apps/web/test` for `MENU_FOOT`/`ACCOUNT_STOPS` references and update.
- [ ] **Step 4: Run the test and the account test**: `pnpm exec vitest run test/jobPageText.test.ts test/account.test.ts` → PASS. `pnpm exec eslint apps/web/src/workspace/AppShell.ts apps/web/src/workspace/views/SetupView.ts ...` → if it says a baseline entry improved, lower it.
- [ ] **Step 5: Commit** `Drop the job page reassurance lines and give step 4 a Check hint`

### Task 2: The file block replaces the top job bar

**Files:**
- Create: `apps/web/src/workspace/views/run/fileBlock.ts` (replaces `fileCard.ts`, which is deleted)
- Rewrite: `apps/web/src/workspace/views/run/identity.ts` → `projectLine.ts` (project name or Save to project only)
- Modify: `apps/web/src/workspace/views/run/layout.ts` (drop `JobCard`, `files` state, the drawer, `JobFiles` import; the `job-main` keeps `OverrideControls`)
- Modify: `apps/web/src/workspace/views/run/steps.ts` (`JobWorkPanel` renders `JobFileBlock` first, `hidden` unless step is `place`)
- Modify: `apps/web/src/projects/ProjectsView.ts` (delete `JobFiles`; drop now-unused imports)
- Modify: `apps/web/src/styles/workspace.css`, `apps/web/src/styles/job-layout.css` (remove `.job-card`, `.job-id`, `.job-icon`, `.job-name`, `.job-actions`, `.job-identity`, `.job-save`, `.job-files-drawer` rules; add `.job-file-block` rules)
- Modify: `apps/web/test/shell.test.ts:189` (drop `files|files-close|projects` from the `job-` allowlist)
- Test: `apps/web/test/fileBlock.test.ts` (new)

**Interfaces:**
- Produces: `JobFileBlock({ parts, model, onView, step }: { parts: PreviewParts; model: WorkspaceModel | null; onView: (view: string) => void; step: JobStep }): ComponentChild`. Section attributes: `data-job-panel="file"`, `data-region="job"`, `hidden` when `step !== 'place'`. Inside: `[data-preview="file-name"]` (text `none` when no file, `sr-only`), the picker `label.file-button > input[data-preview="file"]` ("Open a file" / "Open another"), `button[data-action="job-close"]` when a file is open, the lock help, `[data-job="note"]`, and `JobProjectLine`.
- Produces: `JobProjectLine({ job, fileOpen, onNote })`: project job → `p.fine` with `span[data-job="project"]` holding the project name; draft with a file open → `select[data-job="save-target"]` + `button[data-action="job-save-to-project"]`; otherwise null.

- [ ] **Step 1: Write the failing test** `apps/web/test/fileBlock.test.ts` using `root/all/byAttr/text` from `./tree.ts` and a minimal `parts` (`state: { status: 'idle', ready: true, fileName: null, ... }`, `actions: {}`): (a) at step `place` the section is not hidden, contains `input[data-preview="file"]`, the file-name span text is `none`, no `job-close`; (b) at step `machine` the section has `hidden: true`; (c) with `fileName: 'plate.nc'` and `status: 'ready'` the label reads `Open another` and `job-close` exists; (d) `JobProjectLine` with a project job renders `[data-job="project"]`, with a draft and `fileOpen: true` renders `job-save-to-project`.
- [ ] **Step 2: Run** `pnpm exec vitest run test/fileBlock.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `fileBlock.ts` from `fileCard.ts`'s `fileActions`/`fileIdentity` (drop Files/Open project buttons, the icon, the h1, `aria-labelledby`); `projectLine.ts` from `identity.ts` (drop name, machine, bed, state spans); wire `steps.ts` and `layout.ts`; delete `fileCard.ts`, `identity.ts`, `JobFiles`; CSS.
- [ ] **Step 4: Run** `pnpm exec vitest run test/fileBlock.test.ts test/shell.test.ts`, `pnpm exec tsc --noEmit -p apps/web`, `pnpm exec eslint apps/web/src/workspace/views/run apps/web/src/projects/ProjectsView.ts`, `pnpm exec depcruise apps/web/src --config .dependency-cruiser.cjs` → all PASS.
- [ ] **Step 5: Commit** `Move the job's file controls into step 3 and drop the top bar`

### Task 3: e2e specs follow the moved controls

**Files:**
- Modify: `tools/e2e/specs/project-open.fake-serial.ts` (drawer steps → Projects view `project-open-in-run`; `.job-actions [data-action="job-projects"]` → the rail's Projects view; click `[data-job-step="place"]` before `job-close`)
- Modify: `tools/e2e/specs/job-workspace.fake-serial.ts:45-55` (drawer assertions → Projects view file visible; keep the stop-controls box check)
- Modify: `tools/e2e/specs/jobs.fake-serial.ts:94`, `tools/e2e/specs/job-modes.fake-serial.ts:51` (click `[data-job-step="place"]` before `job-close`)
- Modify: `tools/e2e/specs/job-model.fake-serial.ts:72-90,107-108` (identity assertions → `[data-job="project"]`, step 1's `[data-job-step="machine"] small`, `[data-setup="bed"] [data-bed]`)
- Modify: `tools/e2e/specs/job-layout.fake-serial.ts:86-87,134`, `tools/e2e/specs/workspace.fake-serial.ts:192` (`.job-card` → `.job-step-bar`)

- [ ] **Step 1: Edit the specs** as listed; `pnpm exec tsc --noEmit -p tools/e2e`.
- [ ] **Step 2: Run one fake-serial spec if the build allows** (`pnpm build:fake-serial` then `cd tools/e2e && RUN_E2E_FAKE_SERIAL=1 RUN_E2E_PORT=8795 pnpm exec playwright test -c playwright.fake-serial.config.ts specs/project-open.fake-serial.ts`). If the fake-serial diff gate stands in the way, record it as deferred for the lead's gates.
- [ ] **Step 3: Commit** `Point the job specs at the step 3 file block`

### Task 4: `validRunSession` in authSession.ts

**Files:**
- Modify: `workers/run/src/authSession.ts`
- Test: `workers/run/test/avatar.test.ts` (first case)

**Interfaces:**
- Produces: `validRunSession(request: Request, config: AuthConfig): Promise<AccountsSession | null>`: the cookie read, `validateSession`, the expiry/client/sub checks now inside `runSessionIdentity`, which becomes a thin wrapper. `githubIdentityId(session: Pick<AccountsSession, 'identities'>): string | null` returns the GitHub identity's id when it matches `/^\d{1,20}$/`.

- [ ] **Step 1: Failing test**: `githubIdentityId({ identities: [{ provider: 'github', id: '231731', login: 'x' }] })` is `'231731'`; `'12a'`, `''`, `'1/2'`, no github identity → `null`.
- [ ] **Step 2: Run** `cd workers/run && pnpm exec vitest run test/avatar.test.ts` → FAIL. **Step 3: Implement.** **Step 4: Run** `test/avatar.test.ts test/connect-role.test.ts test/identity.test.ts` → PASS. **Step 5: Commit** `Split the run session check from its identity`

### Task 5: `GET /api/avatar`

**Files:**
- Create: `workers/run/src/avatarRoute.ts`
- Modify: `workers/run/src/dataRoute.ts` (route `/api/avatar`), `workers/run/src/routes.ts` (header comment lists it)
- Modify: `tools/gates/src/source/workerUpstreams.ts` (entry `{ file: 'avatarRoute.ts', text: 'https://avatars.githubusercontent.com/u/${id}?s=96&v=4', why }`)
- Test: `workers/run/test/avatar.test.ts`, `tools/gates/test/worker-upstreams.test.ts` (no enumeration change needed; run it)

**Interfaces:**
- Produces in `avatarRoute.ts`:
  - `AVATAR_MAX_BYTES = 256 * 1024`, `AVATAR_TIMEOUT_MS = 10_000`, `AVATAR_TYPES = ['image/png','image/jpeg','image/gif','image/webp']`, `AVATAR_CACHE_CONTROL = 'private, max-age=86400'`.
  - `interface AvatarCache { get(id: string): Promise<CachedAvatar | undefined>; put(id: string, value: CachedAvatar): Promise<void> }`, `CachedAvatar = { bytes: Uint8Array<ArrayBuffer>; type: string }`.
  - `interface AvatarDeps { fetch: FetchLike; cache: AvatarCache }` (`FetchLike` from firmwareProxy.ts).
  - `memoryAvatarCache(): AvatarCache`; `liveAvatarDeps(origin: string): AvatarDeps` (Cache API `caches.default` under `${origin}/api/avatar/.github/${id}`, map-less fallback stores nothing).
  - `avatarRoute(request: Request, env: Env, deps: AvatarDeps): Promise<Response>`: non-GET → 405; `authConfig` null or no valid session → 401 `{error:'unauthorized'}`; no GitHub id → 404 `{error:'not_found'}`; cache hit → bytes; else fetch `https://avatars.githubusercontent.com/u/${id}?s=96&v=4` with `{ method:'GET', redirect:'manual', headers:{accept:'image/*'}, signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) }`; status ≠200, type not listed, body >256 KB or a throw → 404; else cache and answer 200 with `content-type`, `content-length`, `cache-control: private, max-age=86400`, `vary: Cookie`.
- `dataRoute` gains `avatar?: AvatarDeps` in its context and routes `/api/avatar` to `avatarRoute(request, env, context.avatar ?? liveAvatarDeps(origin))`; `route()` passes `avatar` through from a new optional parameter object or reuses `firmwareDeps`-style injection (keep ≤4 params: bundle `firmwareDeps` and `avatar` into one optional `deps` object only if needed; otherwise read `origin` from the request URL inside dataRoute).

- [ ] **Step 1: Failing tests** in `avatar.test.ts` using `authEnv('production', clock)` + `seedSession()` like `connect-role.test.ts`, a fake `fetch` recording URLs and a `memoryAvatarCache()`:
  1. no cookie → 401 JSON `{ error: 'unauthorized' }`, fetch not called;
  2. session without a github identity (mutate `h.session.identities = []`) → 404 `{ error: 'not_found' }`, fetch not called;
  3. a PNG upstream → 200, `content-type: image/png`, bytes equal, `cache-control` `private, max-age=86400`, `vary` `Cookie`; the fetched URL is `https://avatars.githubusercontent.com/u/231731?s=96&v=4` and init has `redirect: 'manual'`;
  4. `text/html` upstream → 404; a 302 upstream → 404;
  5. a body of 256 KB + 1 → 404, exactly 256 KB → 200;
  6. second request with the same id → one upstream fetch in total; a second session with id `'7'` → a second fetch to `/u/7`;
  7. through `worker.fetch` with `vi.stubGlobal('fetch', …)` returning a PNG: status 200 and every `SECURITY_HEADERS` entry present; signed out through the handler → 401 with the headers;
  8. POST → 405.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `avatarRoute.ts`, wire `dataRoute.ts`, add the upstream entry. **Step 4: Run** `cd workers/run && pnpm exec vitest run test/avatar.test.ts test/routes.test.ts test/connect-role.test.ts`; `cd tools/gates && pnpm exec vitest run test/worker-upstreams.test.ts test/worker-build.test.ts`; `pnpm exec tsc --noEmit -p workers/run`; `pnpm exec eslint workers/run/src tools/gates/src/source/workerUpstreams.ts` → PASS.
- [ ] **Step 5: Commit** `Serve the signed-in user's GitHub avatar same-origin`

### Task 6: The avatar image in the account menu

**Files:**
- Modify: `apps/web/src/workspace/AccountMenu.ts` (`avatar(size, large)` helper rendering the span with the img when signed in)
- Modify: `apps/web/src/styles/workspace.css` (`.avatar { position: relative; overflow: hidden }`, `.avatar-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 50% }`, `.avatar-image[hidden] { display: none }`)
- Test: `apps/web/test/accountMenu.test.ts` (new)

**Interfaces:**
- Produces: `AVATAR_SRC = '/api/avatar'`; signed-in → `img.avatar-image[src="/api/avatar"][alt=""][decoding="async"][referrerpolicy="no-referrer"]` with `width`/`height` 32 in the button and 40 in the menu head; `onError` sets `hidden` on the image. Signed-out and checking render no image.

- [ ] **Step 1: Failing test**: render `AccountMenuView` signed-in with `open: true` → two `img` with `src` `/api/avatar` and `alt` `''`; signed-out and checking → none; the `onError` handler hides the image (call it with `{ currentTarget: { hidden: false } }`).
- [ ] **Step 2: Run** `pnpm exec vitest run test/accountMenu.test.ts` → FAIL. **Step 3: Implement.** **Step 4: Run** it plus `test/account.test.ts test/shell.test.ts`, `pnpm exec eslint apps/web/src/workspace/AccountMenu.ts` → PASS. **Step 5: Commit** `Show the GitHub avatar in the account button`

### Task 7: e2e: avatar stub and the walkthrough screenshots

**Files:**
- Modify: `tools/e2e/specs/connect-role.e2e.ts` (route `**/api/avatar` → `icon-32.png` bytes with `content-type: image/png`; assert `.account-button img.avatar-image` visible and `naturalWidth > 0`; with `RUN_SCREENSHOTS=1` shoot `.topbar .account` (closed) and the open menu, light and dark, into `docs/design/screenshots/job-page-cleanup/`)
- Create: `tools/e2e/specs/job-page-cleanup.e2e.ts` (signed-in stub; `.job-card` count 0; footer has no 'Review settings'; `[data-job-step="check"] small` reads 'Review the safety verdict'; `[data-job-panel="file"]` hidden at step 1, visible at step 3; screenshots `job-light-1280.png`, `job-light-320.png`)
- Create: `docs/design/JOB_PAGE_CLEANUP.md`

- [ ] **Step 1: Write the specs.** **Step 2: `pnpm build`, then** `cd tools/e2e && RUN_SCREENSHOTS=1 pnpm exec playwright test specs/connect-role.e2e.ts specs/job-page-cleanup.e2e.ts` → PASS and six PNGs written. **Step 3: Write the walkthrough** in the style of `docs/design/LOGO_PLACEMENTS.md`. **Step 4: Commit** `Add the job page cleanup walkthrough and its browser checks`
