# Sign-in front door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On run.synthetos.com a visitor without a session sees the workspace dimmed under one dialog with the run
wordmark and a single "Continue with GitHub" button, and can do nothing else until signed in.

**Architecture:** A pure `gateState()` turns the existing account state plus "is this a hosted origin" into one of
five gate kinds. A `SignInGate` component renders the scrim and dialog for the locked kinds, and `AppShell` marks every
other top-level region `inert` while locked. The run wordmark is a Preact component in a new `brand/` folder, the first
asset of the logo family. The first-visit card this replaces is deleted.

**Tech Stack:** Preact + @preact/signals, vitest unit tests rendered through `apps/web/test/tree.ts`, Playwright e2e
(`tools/e2e`), the existing CSS tokens.

**Spec:** `docs/superpowers/specs/2026-11-16-first-run-design.md`, sections 4 (logo geometry), 5 (front door), 9 slice 1.

## Global Constraints

- Files ≤ 400 lines, functions ≤ 80 lines, complexity ≤ 15 (AppShell's own baseline: complexity 20, 90 lines; it may not grow), ≤ 4 params; `tools/gates/modularity-baseline.json` may only shrink.
- 100 % coverage on touched files; lint, typecheck and dependency-cruiser clean; no `pnpm check`/`e2e` runs by agents (targeted tests only; the lead gates).
- Copy is sentence case, short sentences, no all-caps labels. No reassurance or safety filler anywhere in the gate.
- Sign-in is a plain `<a>` to `signInHref(location.pathname)`; CSP `form-action 'none'` stands; no new sign-in path.
- Colours only from tokens: `--ink`, `--muted`, `--sheet`, `--paper`, `--rule`, `--blue`, `--on-blue`, `--pop`.
- Commit messages carry no AI attribution. One concern per commit.
- Nothing in the gate touches browser storage.

## Review Focus

1. A page that is `checking` for a long time on a hosted origin (slow Worker) must show the scrim without the dialog and never flash the workspace as usable: pinned in Task 2 (`gateState` `checking` → `'checking'`) and Task 4 (scrim rendered, no dialog, app `inert`).
2. The theme toggle sits behind the lock, so the dialog must be readable in both themes with the saved theme applied before hydration: pinned in Task 5 (screenshots light and dark).
3. A keyboard user must not be able to Tab out of the dialog into the dimmed workspace: pinned in Task 5 (Tab from the button lands on the "What we store" link, then the overview link, then back on the button; the rail has `inert`).
4. A visitor who arrives on another page of the site (`/?view=projects` style paths do not exist; the only paths are `/`, `/safety/`, `/privacy/`, `/wiring/`, `/update/`) must get back to the same page after sign-in: pinned in Task 3 (`href` is `signInHref(pathname)`; for `/` it is exactly `/auth/login`).
5. A signed-out visitor on the bench build or a localhost dev page must see no lock: pinned in Task 2 (`checking` and `signed-out, signIn:false` on a non-hosted origin → `'open'`).

---

### Task 1: The run wordmark, the GitHub mark and a book icon

**Files:**
- Create: `apps/web/src/brand/RunWordmark.ts`
- Create: `apps/web/src/brand/GitHubMark.ts`
- Modify: `apps/web/src/workspace/icons.ts` (add `book` to `PATHS`)
- Test: `apps/web/test/brand.test.ts`

**Interfaces:**
- Produces: `RunWordmark(props: { readonly height: number; readonly label?: string }): ComponentChild` — an inline `<svg viewBox="-2 2 66 46" height={height}>` with `role="img"` and `aria-label` = `label ?? 'run'`; ink parts `stroke="currentColor"`, blue parts `stroke="var(--blue)"` / `fill="var(--blue)"`.
- Produces: `WORDMARK_GEOMETRY` — `Object.freeze({ viewBox: '-2 2 66 46', stroke: 3.4, r: 'M4 40V16M4 25a9 9 0 0 1 9-9', u: 'M20 16v16a8 8 0 0 0 16 0V16M36 16v24', nStem: 'M44 40V16', nArch: 'M44 24a8 8 0 0 1 16 0v16', tool: { cx: 60, cy: 40, r: 3.4 }, dash: '0.01 7.14' })` (the spec's section 4 numbers; the icon generator in slice 2 reads these).
- Produces: `GitHubMark(size: number): ComponentChild` — the GitHub mark as one filled path (`fill="currentColor"`, `viewBox="0 0 16 16"`, `aria-hidden="true"`).
- Produces: `Icon('book', size)` — a stroke icon in the existing 24-grid style.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/test/brand.test.ts
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { all, byAttr, root } from './tree.ts';
import { RunWordmark, WORDMARK_GEOMETRY } from '../src/brand/RunWordmark.ts';
import { GitHubMark } from '../src/brand/GitHubMark.ts';
import { Icon } from '../src/workspace/icons.ts';

describe('RunWordmark', () => {
  it('draws r, u and the n as an arc move: dashed ink stem, blue arch, blue tool', () => {
    const svg = root(h(RunWordmark, { height: 44 }));
    expect(svg.props['viewBox']).toBe(WORDMARK_GEOMETRY.viewBox);
    expect(svg.props['height']).toBe(44);
    expect(svg.props['role']).toBe('img');
    expect(svg.props['aria-label']).toBe('run');
    const paths = all(svg, (e) => e.tag === 'path');
    expect(paths.map((p) => p.props['d'])).toEqual([WORDMARK_GEOMETRY.r, WORDMARK_GEOMETRY.u, WORDMARK_GEOMETRY.nStem, WORDMARK_GEOMETRY.nArch]);
    expect(paths[2]?.props['stroke-dasharray']).toBe(WORDMARK_GEOMETRY.dash);
    expect(paths[2]?.props['stroke']).toBe('currentColor');
    expect(paths[3]?.props['stroke']).toBe('var(--blue)');
    const tool = all(svg, (e) => e.tag === 'circle')[0];
    expect(tool?.props).toMatchObject({ cx: 60, cy: 40, r: 3.4, fill: 'var(--blue)' });
    expect(paths.every((p) => p.props['stroke-width'] === 3.4 && p.props['stroke-linecap'] === 'round')).toBe(true);
  });
  it('takes a label for the lockup', () => {
    expect(root(h(RunWordmark, { height: 22, label: 'Synthetos run' })).props['aria-label']).toBe('Synthetos run');
  });
});

describe('GitHubMark and the book icon', () => {
  it('GitHubMark is one filled, hidden path', () => {
    const svg = root(GitHubMark(18));
    expect(svg.props).toMatchObject({ width: 18, height: 18, viewBox: '0 0 16 16', 'aria-hidden': 'true' });
    expect(all(svg, (e) => e.tag === 'path').map((p) => p.props['fill'])).toEqual(['currentColor']);
  });
  it('book is a 24-grid stroke icon', () => {
    const svg = root(Icon('book', 15));
    expect(svg.props['viewBox']).toBe('0 0 24 24');
    expect(all(svg, (e) => e.tag === 'path')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && pnpm vitest run test/brand.test.ts`
Expected: FAIL, cannot resolve `../src/brand/RunWordmark.ts`.

- [ ] **Step 3: Implement `RunWordmark`, `WORDMARK_GEOMETRY`, `GitHubMark`, and add `book` to `PATHS`**

`RunWordmark.ts`: four `h('path', …)` children in the order r, u, nStem, nArch, then the `circle`. Ink paths: `fill:'none', stroke:'currentColor', 'stroke-width': 3.4, 'stroke-linecap':'round', 'stroke-linejoin':'round'`; the stem adds `'stroke-dasharray': WORDMARK_GEOMETRY.dash`; the arch uses `stroke:'var(--blue)'`; the circle `fill:'var(--blue)', stroke:'none'`. `GitHubMark.ts`: the standard GitHub Octicon mark path (16-grid). `book`: `'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5ZM4 20.5V5.5M8 7h8M8 10.5h8'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run test/brand.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/brand apps/web/src/workspace/icons.ts apps/web/test/brand.test.ts
git commit -m "Add the run wordmark, the GitHub mark and a book icon"
```

---

### Task 2: The gate state

**Files:**
- Create: `apps/web/src/gate/gateState.ts`
- Test: `apps/web/test/gateState.test.ts`

**Interfaces:**
- Consumes: `AccountState` from `apps/web/src/live/account.ts` (`status`, `signIn`); `environmentForOrigin(origin): Environment | null` from `@synthetos/protocol`.
- Produces: `type GateKind = 'open' | 'checking' | 'sign-in' | 'not-offered' | 'unavailable'`; `gateState(state: AccountState, hosted: boolean): GateKind`; `hostedOrigin(origin: string): boolean` (true when `environmentForOrigin(origin)` is not null); `lockProps(kind: GateKind): { readonly inert?: true }` (`{ inert: true }` for every kind but `'open'`, else `{}`).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/test/gateState.test.ts
import { describe, expect, it } from 'vitest';
import { gateState, hostedOrigin, lockProps } from '../src/gate/gateState.ts';
import type { AccountState } from '../src/live/account.ts';

const st = (status: AccountState['status'], signIn: boolean): AccountState => ({ status, signIn, display: status === 'signed-in' ? '@owner' : null, message: null });

describe('gateState', () => {
  it('follows the spec table on a hosted origin', () => {
    expect(gateState(st('signed-in', true), true)).toBe('open');
    expect(gateState(st('signed-out', true), true)).toBe('sign-in');
    expect(gateState(st('signed-out', false), true)).toBe('not-offered');
    expect(gateState(st('checking', false), true)).toBe('checking');
    expect(gateState(st('unavailable', false), true)).toBe('unavailable');
  });
  it('locks a non-hosted origin only when the session read offers sign-in and nobody is signed in', () => {
    expect(gateState(st('signed-out', true), false)).toBe('sign-in');
    expect(gateState(st('signed-out', false), false)).toBe('open');
    expect(gateState(st('checking', false), false)).toBe('open');
    expect(gateState(st('unavailable', false), false)).toBe('open');
    expect(gateState(st('signed-in', true), false)).toBe('open');
  });
});

describe('hostedOrigin and lockProps', () => {
  it('names the two hosted origins and nothing else', () => {
    expect(hostedOrigin('https://run.synthetos.com')).toBe(true);
    expect(hostedOrigin('https://staging.run.synthetos.com')).toBe(true);
    expect(hostedOrigin('http://127.0.0.1:8793')).toBe(false);
    expect(hostedOrigin('http://localhost:5173')).toBe(false);
  });
  it('lockProps is inert for every locked kind', () => {
    expect(lockProps('open')).toEqual({});
    for (const k of ['checking', 'sign-in', 'not-offered', 'unavailable'] as const) expect(lockProps(k)).toEqual({ inert: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm vitest run test/gateState.test.ts`
Expected: FAIL, cannot resolve `../src/gate/gateState.ts`.

- [ ] **Step 3: Implement `gateState`, `hostedOrigin`, `lockProps` in `apps/web/src/gate/gateState.ts`**

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && pnpm vitest run test/gateState.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/gate/gateState.ts apps/web/test/gateState.test.ts
git commit -m "Decide the sign-in gate from the account state and the origin"
```

---

### Task 3: The gate view and component

**Files:**
- Create: `apps/web/src/gate/SignInGate.ts`
- Create: `apps/web/src/styles/gate.css`
- Modify: `apps/web/src/entries/workspace.ts:42-49` (add `import '../styles/gate.css';` after `project-zip.css`)
- Test: `apps/web/test/signInGate.test.ts`

**Interfaces:**
- Consumes: Task 1 `RunWordmark`, `GitHubMark`, `Icon('book')`; Task 2 `GateKind`, `gateState`, `hostedOrigin`; `accountState` and `signInHref` from `live/account.ts`.
- Produces: `SignInGateView(p: { readonly kind: GateKind; readonly href: string }): ComponentChild` (pure); `SignInGate(): ComponentChild` (reads `accountState.value` and `location`); exported copy constants `GATE_TITLE = 'Sign in to use Run'`, `GATE_TEXT = 'Run keeps your machines, tools, materials and projects in your Synthetos account. Signing in takes one click with GitHub.'`, `GATE_BUTTON = 'Continue with GitHub'`, `GATE_NEW = 'New here? The same button creates your Synthetos account.'`, `GATE_STORE = 'What we store'`, `GATE_OVERVIEW = 'What is Run? Read the overview'`, `GATE_SOON = 'Sign-in opens on this site soon.'`, `GATE_DOWN = 'The account service did not answer. Try again in a minute.'`, `STORE_HREF = 'https://accounts.synthetos.com/privacy'`, `OVERVIEW_HREF = 'https://github.com/synthetos/run#readme'`.

Structure the view renders (null for `'open'`):

```
div.gate-scrim[aria-hidden=true]                         (every locked kind)
div.gate[role=dialog][aria-modal=true][aria-labelledby=gate-title][data-gate=<kind>]   (not for 'checking')
  div.dialog.gate-dialog
    RunWordmark {height: 44, label: 'run'}
    h2#gate-title  GATE_TITLE
    p.gate-text    GATE_TEXT
    [sign-in | unavailable]  a.button.primary.gate-button[href=p.href][data-action=sign-in]  GitHubMark(18) + GATE_BUTTON
    [unavailable]            p.gate-fine[role=alert]  GATE_DOWN
    [not-offered]            p.gate-fine[data-gate-note=soon]  GATE_SOON
    [sign-in | unavailable]  p.gate-fine  GATE_NEW + ' ' + a[href=STORE_HREF][rel=noopener][target=_blank] GATE_STORE
    hr.gate-rule
    a.gate-learn[href=OVERVIEW_HREF][rel=noopener][target=_blank]  Icon('book', 15) + GATE_OVERVIEW
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/test/signInGate.test.ts
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { all, byAttr, one, root, text } from './tree.ts';
import { GATE_BUTTON, GATE_DOWN, GATE_SOON, GATE_TITLE, OVERVIEW_HREF, STORE_HREF, SignInGateView } from '../src/gate/SignInGate.ts';

describe('SignInGateView', () => {
  it('renders nothing when open', () => {
    expect(SignInGateView({ kind: 'open', href: '/auth/login' })).toBeNull();
  });
  it('checking shows the scrim and no dialog', () => {
    const el = root(h('div', null, SignInGateView({ kind: 'checking', href: '/auth/login' })));
    expect(all(el, (e) => e.props['class'] === 'gate-scrim')).toHaveLength(1);
    expect(all(el, byAttr('role', 'dialog'))).toHaveLength(0);
  });
  it('sign-in: dialog with the wordmark alone, the title, one GitHub button to the return path, and the two links', () => {
    const el = root(h('div', null, SignInGateView({ kind: 'sign-in', href: '/auth/login?return_to=%2Fupdate%2F' })));
    const dialog = one(el, byAttr('role', 'dialog'));
    expect(dialog.props['aria-modal']).toBe('true');
    expect(dialog.props['aria-labelledby']).toBe('gate-title');
    expect(dialog.props['data-gate']).toBe('sign-in');
    expect(all(dialog, byAttr('role', 'img')).map((e) => e.props['aria-label'])).toEqual(['run']);
    expect(text(one(dialog, (e) => e.tag === 'h2'))).toBe(GATE_TITLE);
    const button = one(dialog, byAttr('data-action', 'sign-in'));
    expect(button.tag).toBe('a');
    expect(button.props['href']).toBe('/auth/login?return_to=%2Fupdate%2F');
    expect(text(button)).toContain(GATE_BUTTON);
    expect(all(dialog, (e) => e.tag === 'a').map((a) => a.props['href'])).toEqual(['/auth/login?return_to=%2Fupdate%2F', STORE_HREF, OVERVIEW_HREF]);
    expect(all(dialog, (e) => e.tag === 'button')).toHaveLength(0);
    expect(text(dialog)).not.toMatch(/E-stop|never need|Saved in this browser/);
  });
  it('not-offered: no button, the soon line', () => {
    const dialog = one(root(h('div', null, SignInGateView({ kind: 'not-offered', href: '/auth/login' }))), byAttr('role', 'dialog'));
    expect(all(dialog, byAttr('data-action', 'sign-in'))).toHaveLength(0);
    expect(text(one(dialog, byAttr('data-gate-note', 'soon')))).toBe(GATE_SOON);
    expect(all(dialog, (e) => e.tag === 'a').map((a) => a.props['href'])).toEqual([OVERVIEW_HREF]);
  });
  it('unavailable: the button stays, with the retry line as an alert', () => {
    const dialog = one(root(h('div', null, SignInGateView({ kind: 'unavailable', href: '/auth/login' }))), byAttr('role', 'dialog'));
    expect(all(dialog, byAttr('data-action', 'sign-in'))).toHaveLength(1);
    expect(text(one(dialog, byAttr('role', 'alert')))).toBe(GATE_DOWN);
  });
});
```

Add a second describe for the component, using `accountState` and a stubbed `location`:

```ts
import { accountState, CHECKING } from '../src/live/account.ts';
import { SignInGate } from '../src/gate/SignInGate.ts';
import { afterEach, vi } from 'vitest';

describe('SignInGate', () => {
  afterEach(() => { accountState.value = CHECKING; vi.unstubAllGlobals(); });
  it('is open on a non-hosted origin while checking, and locked once sign-in is offered', () => {
    vi.stubGlobal('location', { origin: 'http://127.0.0.1:4173', pathname: '/' });
    expect(SignInGate()).toBeNull();
    accountState.value = { status: 'signed-out', signIn: true, display: null, message: null };
    const dialog = one(root(h('div', null, h(SignInGate, null))), byAttr('role', 'dialog'));
    expect(one(dialog, byAttr('data-action', 'sign-in')).props['href']).toBe('/auth/login');
  });
  it('shows the scrim alone while checking on a hosted origin', () => {
    vi.stubGlobal('location', { origin: 'https://staging.run.synthetos.com', pathname: '/' });
    const el = root(h('div', null, h(SignInGate, null)));
    expect(all(el, (e) => e.props['class'] === 'gate-scrim')).toHaveLength(1);
    expect(all(el, byAttr('role', 'dialog'))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm vitest run test/signInGate.test.ts`
Expected: FAIL, cannot resolve `../src/gate/SignInGate.ts`.

- [ ] **Step 3: Implement `SignInGateView` and `SignInGate` in `apps/web/src/gate/SignInGate.ts`**

`SignInGate` computes `kind = gateState(accountState.value, typeof location === 'undefined' ? false : hostedOrigin(location.origin))` and `href = signInHref(typeof location === 'undefined' ? '/' : location.pathname)`, then returns `SignInGateView({ kind, href })`. Keep the view under 80 lines by giving the dialog body its own function `gateBody(kind, href)`. Focus: the dialog element gets `tabindex: -1` and an effect that focuses the sign-in link when present (else the dialog) on mount; no other focus handling (the `inert` on the rest of the page, Task 4, keeps Tab inside).

- [ ] **Step 4: Write `apps/web/src/styles/gate.css` and import it**

```css
/* The sign-in front door (docs/superpowers/specs/2026-11-16-first-run-design.md §5). */
.gate-scrim { position: fixed; inset: 0; z-index: calc(var(--z-dialog) + 1); background: color-mix(in srgb, var(--ink) 38%, transparent); backdrop-filter: blur(1.5px); }
.gate { position: fixed; inset: 0; z-index: calc(var(--z-dialog) + 2); display: flex; align-items: center; justify-content: center; padding: 24px; }
.gate-dialog { width: 440px; padding: 28px 28px 22px; text-align: center; border-radius: 10px; }
.gate-dialog > svg { display: block; margin: 0 auto 14px; color: var(--ink); }
.gate-dialog h2 { font-size: 22px; line-height: 1.25; margin: 2px 0 6px; font-weight: 600; }
.gate-text { font-size: 13.5px; line-height: 1.55; color: var(--muted); margin: 0 auto 18px; max-width: 34ch; }
.gate-button { width: 100%; min-height: 44px; gap: 10px; font-size: 14.5px; font-weight: 600; border-radius: 6px; }
.gate-button svg { width: 18px; height: 18px; }
.gate-fine { font-size: 12px; color: var(--muted); margin: 12px 0 0; }
.gate-fine a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.gate-rule { border: 0; border-top: 1px solid var(--rule); margin: 18px 0 12px; }
.gate-learn { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--ink); text-decoration: none; }
.gate-learn:hover { text-decoration: underline; text-underline-offset: 2px; }
@media (max-width: 480px) { .gate { padding: 12px; } .gate-dialog { padding: 22px 18px 18px; } }
```

Add `import '../styles/gate.css';` to `apps/web/src/entries/workspace.ts` after the `project-zip.css` import.

- [ ] **Step 5: Run to verify pass, and typecheck the app**

Run: `cd apps/web && pnpm vitest run test/signInGate.test.ts && pnpm exec tsc --noEmit -p .`
Expected: PASS (7 tests); tsc prints nothing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/gate/SignInGate.ts apps/web/src/styles/gate.css apps/web/src/entries/workspace.ts apps/web/test/signInGate.test.ts
git commit -m "Add the sign-in gate dialog"
```

---

### Task 4: Lock the shell and retire the first-visit card

**Files:**
- Modify: `apps/web/src/workspace/AppShell.ts` (render tree, lines ~222-279; import list)
- Delete: `apps/web/src/live/FirstVisitCard.ts`, `apps/web/test/firstVisit.test.ts`
- Modify: `apps/web/test/shell.test.ts:1` (drop the `SignInCard` import and whatever used it)
- Modify: `apps/web/src/styles/features.css:535-538` (delete the `.first-visit-*` rules)
- Modify: `tools/gates/modularity-baseline.json` (remove any `FirstVisitCard` entries; add none)
- Test: `apps/web/test/appShellGate.test.ts`

**Interfaces:**
- Consumes: Task 2 `gateState`, `hostedOrigin`, `lockProps`; Task 3 `SignInGate`.
- Produces: `AppShell` returns a Fragment of two children: the existing `div.app` with `...lock` spread onto it, and `h(SignInGate, null)` as its sibling (outside `.app`, so the dialog is never inert itself), where `lock = lockProps(gateState(accountState.value, hosted))` and `hosted = typeof location === 'undefined' ? false : hostedOrigin(location.origin)`. The prerender has no `location`, so the prerendered HTML is unchanged (no `inert`, no gate); hydration adds them on a locked page. The `FirstVisitCard` line is removed. `accountNotice.ts` loses `ACCOUNT_MEANWHILE` and `WITHOUT_ACCOUNT` and the list that rendered them (spec §7 last bullet).

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/appShellGate.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { all, byAttr, one, root } from './tree.ts';
import { AppShell } from '../src/workspace/AppShell.ts';
import { accountState, CHECKING } from '../src/live/account.ts';
// `build`: construct the same BuildInfo literal apps/web/test/shell.test.ts passes to AppShell.

describe('AppShell under the sign-in gate', () => {
  afterEach(() => { accountState.value = CHECKING; vi.unstubAllGlobals(); });
  it('makes the whole app inert and shows the dialog beside it when sign-in is offered and nobody is signed in', () => {
    vi.stubGlobal('location', { origin: 'https://run.synthetos.com', pathname: '/' });
    accountState.value = { status: 'signed-out', signIn: true, display: null, message: null };
    const tree = root(h('div', null, h(AppShell, { build })));
    const app = one(tree, byAttr('data-shell', 'workspace'));
    expect(app.props['inert']).toBe(true);
    const dialog = one(tree, byAttr('role', 'dialog'));
    expect(dialog.props['data-gate']).toBe('sign-in');
    expect(all(app, byAttr('role', 'dialog'))).toHaveLength(0); // the dialog is a sibling of .app, never inside it
    expect(all(tree, byAttr('data-account', 'first-visit'))).toHaveLength(0);
  });
  it('is the plain shell when signed in', () => {
    vi.stubGlobal('location', { origin: 'https://run.synthetos.com', pathname: '/' });
    accountState.value = { status: 'signed-in', signIn: true, display: '@owner', message: null };
    const tree = root(h('div', null, h(AppShell, { build })));
    expect(one(tree, byAttr('data-shell', 'workspace')).props['inert']).toBeUndefined();
    expect(all(tree, (e) => e.props['class'] === 'gate-scrim')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm vitest run test/appShellGate.test.ts`
Expected: FAIL: `.app` has no `inert`, no dialog, and the `first-visit` card is present.

- [ ] **Step 3: Change `AppShell.ts`**

Remove the `FirstVisitCard` import and the `h(FirstVisitCard, null)` line. Add imports from `../gate/gateState.ts`, `../gate/SignInGate.ts`, `../live/account.ts`. Compute `lock` once (no branches: `lockProps` already decided), spread it on `div.app`'s props, and return `h(Fragment, null, <the div.app>, h(SignInGate, null))`. AppShell's complexity must not rise: no new `if`/`?:` in the function body. Check `apps/web/src/entries/workspace.ts:91` still hydrates (a Fragment root hydrates into `#app`), and `apps/web/build` prerender still renders the same markup for the open state.

- [ ] **Step 4: Delete the first-visit card and its traces**

Delete `apps/web/src/live/FirstVisitCard.ts` and `apps/web/test/firstVisit.test.ts`; remove the `SignInCard` import from `apps/web/test/shell.test.ts` and the assertions that rendered it (the control allowlist still passes because the gate has no buttons); delete the four `.first-visit-*` rules from `features.css`; remove `FirstVisitCard` entries from `tools/gates/modularity-baseline.json` if any exist. In `apps/web/src/live/accountNotice.ts` delete `ACCOUNT_MEANWHILE`, `WITHOUT_ACCOUNT` and the `<ul>` that rendered them inside `AccountNotice`, and the matching assertions in `apps/web/test/accountNotice.test.ts` (or wherever `WITHOUT_ACCOUNT` is asserted: `grep -rn WITHOUT_ACCOUNT apps/web/test`).

- [ ] **Step 5: Run the targeted tests, the typecheck and the dependency rules**

Run: `cd apps/web && pnpm vitest run test/appShellGate.test.ts test/shell.test.ts test/signInGate.test.ts test/accountMenu.test.ts && pnpm exec tsc --noEmit -p . && cd ../.. && pnpm exec depcruise apps/web/src --config .dependency-cruiser.cjs`
Expected: all PASS; tsc silent; depcruise reports no violations (`FirstVisitCard` is gone, nothing imports it). If the depcruise config lives elsewhere, use the command `pnpm lint:deps` in the root `package.json`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/workspace/AppShell.ts apps/web/src/live/accountNotice.ts apps/web/src/styles/features.css apps/web/test tools/gates/modularity-baseline.json
git rm apps/web/src/live/FirstVisitCard.ts apps/web/test/firstVisit.test.ts
git commit -m "Lock the workspace behind the sign-in gate; retire the first-visit card"
```

---

### Task 5: Browser tests, spec updates and the walkthrough screenshots

**Files:**
- Create: `tools/e2e/specs/sign-in-gate.e2e.ts`
- Modify: `tools/e2e/specs/live-entry.e2e.ts:84-118` (delete the three first-visit tests)
- Modify: `tools/e2e/specs/connect-role.e2e.ts:20` (delete the `first-visit` count assertion)
- Modify: `tools/e2e/specs/project-zip.e2e.ts:7,31` and `tools/e2e/specs/browser-sync.e2e.ts:16-17,38` (sign the stub in where the test exercised a signed-out browser-only flow)
- Create: `docs/design/screenshots/sign-in-gate/` (generated)
- Create: `docs/design/SIGN_IN_GATE.md`

**Interfaces:**
- Consumes: the page served by the e2e suite at `http://127.0.0.1:<port>`; `page.route('**/api/session', …)` stubs; `ready(page)` from `./helpers.ts`; the `RUN_SCREENSHOTS` convention from `safety-bar.e2e.ts:21-22,56`.

- [ ] **Step 1: Write `sign-in-gate.e2e.ts`**

```ts
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';
const SCREENSHOTS = process.env['RUN_SCREENSHOTS'] === '1';
const SHOT_DIR = new URL('../../../docs/design/screenshots/sign-in-gate/', import.meta.url).pathname;

for (const theme of ['light', 'dark'] as const) {
  test(`signed-out visitors see the dialog and cannot use the workspace (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.route('**/api/session', (route) => route.fulfill({ json: { account: null, signIn: true } }));
    await page.goto('/'); await ready(page);
    const dialog = page.locator('[data-gate="sign-in"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toHaveText('Sign in to use Run');
    await expect(dialog.locator('[data-action="sign-in"]')).toHaveAttribute('href', '/auth/login');
    await expect(dialog.locator('[data-action="sign-in"]')).toBeFocused();
    await expect(page.locator('.app')).toHaveAttribute('inert', '');
    await page.keyboard.press('Tab'); await expect(dialog.getByRole('link', { name: 'What we store' })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(dialog.getByRole('link', { name: /Read the overview/ })).toBeFocused();
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('.app') ?? null)).toBeNull();
    }
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 740 : 800 });
      await expect(dialog).toBeVisible();
      if (SCREENSHOTS) await page.screenshot({ path: `${SHOT_DIR}gate-${theme}-${width}.png`, fullPage: false });
    }
  });
}
test('a signed-in account sees no gate', async ({ page }) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: { account: { subject: 'usr_owner', display: '@owner', canConnect: true }, signIn: true } }));
  await page.goto('/'); await ready(page);
  await expect(page.locator('[data-gate]')).toHaveCount(0);
  await expect(page.locator('[inert]')).toHaveCount(0);
});
test('where sign-in is not offered the local page stays open', async ({ page }) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: { account: null, signIn: false } }));
  await page.goto('/'); await ready(page);
  await expect(page.locator('[data-gate]')).toHaveCount(0);
});
```

- [ ] **Step 2: Update the signed-out specs**

`live-entry.e2e.ts`: delete the `for (const theme …) { test('first-visit sign-in card …') }` block and the `first-visit card handles blocked storage …` test. `connect-role.e2e.ts:20`: delete the `first-visit` count line. `project-zip.e2e.ts`: change both stubs to `{ account: { subject: 'usr_zip', display: '@zip', canConnect: false }, signIn: true }`. `browser-sync.e2e.ts`: read lines 10-45; where the test's point is the signed-out → signed-in transition, keep the signed-out phase but assert the gate is present and skip interaction until `signedIn = true` and reload; otherwise start signed in.

- [ ] **Step 3: Run the new spec and the four changed specs**

Run: `cd tools/e2e && pnpm exec playwright test specs/sign-in-gate.e2e.ts specs/live-entry.e2e.ts specs/connect-role.e2e.ts specs/project-zip.e2e.ts specs/browser-sync.e2e.ts --project e2e`
(Use the project name the suite defines for `*.e2e.ts`; `pnpm e2e -- --grep` from the root is the lead's form, agents call Playwright directly on named files.)
Expected: all PASS.

- [ ] **Step 4: Produce the screenshots and the walkthrough page**

Run: `cd tools/e2e && RUN_SCREENSHOTS=1 pnpm exec playwright test specs/sign-in-gate.e2e.ts --project e2e`
Expected: four files in `docs/design/screenshots/sign-in-gate/`: `gate-light-1280.png`, `gate-dark-1280.png`, `gate-light-320.png`, `gate-dark-320.png`.

Write `docs/design/SIGN_IN_GATE.md`: what a first-time visitor sees (one paragraph), the state table from the spec §5.1, the four screenshots, how to test it locally (the session stub), and the one-line note that the first-visit card was replaced by this gate on 2026-11-17.

- [ ] **Step 5: Commit**

```bash
git add tools/e2e/specs/sign-in-gate.e2e.ts tools/e2e/specs/live-entry.e2e.ts tools/e2e/specs/connect-role.e2e.ts tools/e2e/specs/project-zip.e2e.ts tools/e2e/specs/browser-sync.e2e.ts docs/design/screenshots/sign-in-gate docs/design/SIGN_IN_GATE.md
git commit -m "Test the sign-in gate in the browser and document it"
```

---

## After the tasks

The lead runs the four suites on the branch head (`pnpm check`, `e2e:fake-serial`, `e2e`, `e2e:staging`), checks the modularity baseline shrank or held, merges ff-only by hash, and the owner pushes. On staging, the acceptance walk from the spec §9 applies: open staging signed out, see the dialog, Continue with GitHub, land back signed in with no gate.
