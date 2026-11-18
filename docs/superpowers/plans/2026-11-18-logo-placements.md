# Logo placements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The run wordmark and its `n` mark appear everywhere spec §4 places them besides the sign-in dialog: the top
bar lockup, the tab icon and PWA icons, standalone SVG files and the README.

**Architecture:** The letter geometry moves into a dependency-free module, `apps/web/src/brand/wordmarkGeometry.ts`,
that both the Preact component and the Node tools import. A small parser in `tools/gates/src/icons/mark.ts` turns the
`n` path strings into circles and segments for the procedural icon renderer, so the PNGs and the SVG share the numbers.
A generator in `tools/gates/src/brand/` writes the standalone SVG files with the literal light and dark token colours.
A `BrandLockup` component replaces the inline top-bar brand markup in `AppShell`.

**Tech Stack:** Preact, vitest (`apps/web/test/tree.ts` renderer), the dependency-free icon renderer in
`tools/gates/src/icons/`, `tools/gates/src/tokens/theme.ts` for token values, Playwright (`tools/e2e`).

**Spec:** `docs/superpowers/specs/2026-11-16-first-run-design.md` §4 (the logo) and §9 slice 2; `docs/design/SIGN_IN_GATE.md`
for how slice 1 uses the wordmark.

## Global Constraints

- Files ≤ 400 lines, functions ≤ 80 lines, complexity ≤ 15, ≤ 4 params. `tools/gates/modularity-baseline.json` may only shrink; `draw.ts` currently tolerates `max-depth 6` in `drawIcon` and `max-params 5` for `ring` and `segment`, and these entries must not grow.
- Geometry numbers appear once, in `WORDMARK_GEOMETRY` (viewBox `-2 2 66 46`, stroke `3.4`, `r` `M4 40V16M4 25a9 9 0 0 1 9-9`, `u` `M20 16v16a8 8 0 0 0 16 0V16M36 16v24`, `nStem` `M44 40V16`, `nArch` `M44 24a8 8 0 0 1 16 0v16`, tool `(60, 40) r 3.4`, dash `0.01 7.14`).
- Colours only from tokens: in CSS contexts `currentColor` and `var(--blue)`; in standalone files the literal `--ink` and `--blue` of each theme read from `apps/web/src/styles/tokens.css` (light ink `#15222c`, blue `#1d5aa6`; dark ink `#e4ebf0`, blue `#7db0f5`). Never a safety colour.
- Icons stay procedural: only `+ − × ÷ Math.sqrt` in shape maths (`draw.ts` header). Maskable content stays inside the centred 40 % circle; monochrome stays white on transparent.
- No other-origin URL in any JS chunk. The SVG files carry `xmlns="http://www.w3.org/2000/svg"` only; they are never imported by app code.
- The top bar link keeps the accessible name "Synthetos Run" and hides the wordmark at `max-width: 650px`, as the grey text does today.
- Targeted tests only; the lead runs the full gates. Commit messages are plain, imperative, without attribution.

## Review Focus

1. A tab icon at 32 px must read as the `n`, not as a blur of the drafting composition: pinned in Task 2 (the `mark` variant renders ink dots and blue arch; icon-32 uses it).
2. The theme toggle changes `--blue` and `--ink`: the lockup must follow (Task 4 uses `currentColor`/`var(--blue)` only; Task 6 screenshots light and dark).
3. `tokens.css` changing a colour must fail a test rather than leave stale SVG files: pinned in Task 3 (fresh render from `loadThemes()` compared byte for byte with the committed files).
4. A screen reader must hear one brand name, not "Synthetos run run": pinned in Task 4 (crosshair `aria-hidden`, wordmark label `Run`, no other text in the link).
5. GitHub's dark theme must not show dark ink on a dark page: pinned in Task 5 (`<picture>` with a `prefers-color-scheme: dark` source).

---

### Task 1: Move the geometry into a dependency-free module

**Files:**
- Create: `apps/web/src/brand/wordmarkGeometry.ts`
- Modify: `apps/web/src/brand/RunWordmark.ts` (import and re-export `WORDMARK_GEOMETRY`)
- Test: `apps/web/test/brand.test.ts` (one added `it`)

**Interfaces:**
- Produces: `export const WORDMARK_GEOMETRY` with the exact object `RunWordmark.ts` holds today, plus `export type WordmarkGeometry = typeof WORDMARK_GEOMETRY`. The module imports nothing (Node tools import it under `tsc -p tools/gates`).
- `RunWordmark.ts` keeps `export { WORDMARK_GEOMETRY }` so existing imports stand.

- [ ] **Step 1: Write the failing test** in `brand.test.ts`:

```ts
import { WORDMARK_GEOMETRY as GEOMETRY } from '../src/brand/wordmarkGeometry.ts';
it('the geometry module is the single source and has no imports', () => {
  expect(GEOMETRY).toBe(WORDMARK_GEOMETRY);
  expect(readFileSync(new URL('../src/brand/wordmarkGeometry.ts', import.meta.url), 'utf8')).not.toMatch(/^import /m);
});
```

- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run test/brand.test.ts` — FAIL (module not found).
- [ ] **Step 3: Create the module, re-export from `RunWordmark.ts`.**
- [ ] **Step 4: Run the test** — PASS. Also `pnpm exec tsc --noEmit -p apps/web`.
- [ ] **Step 5: Commit** `Move the wordmark geometry into a dependency-free module`.

### Task 2: The `n` mark in the icons

**Files:**
- Create: `tools/gates/src/icons/mark.ts`
- Modify: `tools/gates/src/icons/draw.ts` (remove `run`/`runWidth`, add the mark layers, add the `mark` variant, icon-32 uses it)
- Modify: `apps/web/public/icons/*.png` (regenerated by `pnpm gen:icons`)
- Test: `tools/gates/test/mark.test.ts` (new), `tools/gates/test/manifest.test.ts` (adjust the pixel test to the new variant set; it stays the committed-vs-fresh check)

**Interfaces:**
- Produces in `mark.ts`:
  - `interface MarkPrimitives { readonly stem: { x: number; y0: number; y1: number }; readonly arch: { cx: number; cy: number; r: number }; readonly rightStem: { x: number; y0: number; y1: number }; readonly tool: { cx: number; cy: number; r: number }; readonly stroke: number; readonly dots: readonly { x: number; y: number }[] }`
  - `markPrimitives(g: WordmarkGeometry): MarkPrimitives` parses `g.nStem` (`M x y V y`) and `g.nArch` (`M x y a rx ry 0 0 1 dx 0 v dy`) and `g.dash` ("on off"), and returns the dot centres along the stem starting at the path start (`M44 40`) every `on + off` units up to the stem end. Throws on any other path shape.
  - `MARK_BOX = { x: 40, y: 12, w: 24, h: 32 }` (the spec's "viewBox around 40..64 × 12..44").
  - `markShapes(p: MarkPrimitives, fit: { x: number; y: number; scale: number }): { ink: Shape; blue: Shape }` where `Shape` is draw.ts's `(x, y) => boolean` (move `Shape`, `ring`, `segment`, `any` into `tools/gates/src/icons/shapes.ts` so `mark.ts` and `draw.ts` both import them). `ink` is the dots (discs r = stroke/2); `blue` is the top half-ring of the arch (r ± stroke/2), the right stem with round caps, and the tool disc. All in canvas units: `canvas = fit.x + (unit − MARK_BOX.x) × fit.scale`.
- Produces in `draw.ts`: `type Variant = 'any' | 'maskable' | 'monochrome' | 'mark'`; `ICONS` has `icon-32.png` as `variant: 'mark'`. The `any`/`maskable`/`monochrome` composition keeps paper, grid, frame, crosshair and title rule; the title block holds the `n` fitted to a stem height of `56 × k` px centred horizontally at 256, dots in ink, arch in blue (white in monochrome). The `mark` variant is paper plus the `n` filling the canvas with a 48-unit margin per side on a 512 canvas (fit so `MARK_BOX.h` maps to 416).

- [ ] **Step 1: Write the failing tests** `tools/gates/test/mark.test.ts`:

```ts
it('derives the n from the wordmark geometry, so the SVG and the icons share the numbers', () => {
  const p = markPrimitives(WORDMARK_GEOMETRY);
  expect(p.stem).toEqual({ x: 44, y0: 40, y1: 16 });
  expect(p.arch).toEqual({ cx: 52, cy: 24, r: 8 });
  expect(p.rightStem).toEqual({ x: 60, y0: 24, y1: 40 });
  expect(p.tool).toEqual(WORDMARK_GEOMETRY.tool);
  expect(p.stroke).toBe(WORDMARK_GEOMETRY.stroke);
  expect(p.dots.map((d) => d.y)).toEqual([40, 32.85, 25.7, 18.55]);
  expect(WORDMARK_GEOMETRY.nStem).toBe(`M${p.stem.x} ${p.stem.y0}V${p.stem.y1}`);
  expect(WORDMARK_GEOMETRY.nArch).toBe(`M${p.arch.cx - p.arch.r} ${p.arch.cy}a${p.arch.r} ${p.arch.r} 0 0 1 ${2 * p.arch.r} 0v${p.rightStem.y1 - p.rightStem.y0}`);
});
it('refuses a path it does not understand', () => { expect(() => markPrimitives({ ...WORDMARK_GEOMETRY, nStem: 'M1 1L2 2' })).toThrow(); });
it('the mark variant is ink dots and a blue arch on paper, and nothing else', () => {
  const img = drawIcon(64, 'mark');
  // every pixel is paper, ink, blue or a blend of two of them; dots lie on the left stem, blue on the right
});
```

The last test counts pixels: at least one pixel equals `ICON_COLOURS.ink` and lies in the left third, at least one equals `ICON_COLOURS.blue` in the right third, the four corners are paper.

- [ ] **Step 2: Run** `cd tools/gates && pnpm exec vitest run test/mark.test.ts` — FAIL (module not found).
- [ ] **Step 3: Implement `shapes.ts`, `mark.ts`, rewrite the lettering layers in `draw.ts`.** Dot radius uses `stroke/2`; the arch half-ring uses `ring(cx, cy, r − stroke/2, r + stroke/2, 'top')`; round caps on the right stem are a `segment` plus a disc at each end.
- [ ] **Step 4: Run** `test/mark.test.ts` — PASS. Run `test/manifest.test.ts` — the pixel test FAILS (committed PNGs are stale), the colour, safe-zone and monochrome tests PASS.
- [ ] **Step 5: `pnpm gen:icons`**, then `test/manifest.test.ts` — PASS. View the PNGs (Read tool) and confirm the `n` reads at 32 px.
- [ ] **Step 6: Lint** `pnpm exec eslint tools/gates/src/icons tools/gates/test/mark.test.ts`; if the baseline entries for `draw.ts` no longer apply (`ring`/`segment` moved), move or remove them in `modularity-baseline.json` as the lint output says.
- [ ] **Step 7: Commit** `Draw the n mark in the icons from the wordmark geometry`.

### Task 3: Standalone SVG files per theme

**Files:**
- Create: `tools/gates/src/brand/svg.ts`, `tools/gates/src/brand/gen.ts`
- Create (generated): `apps/web/src/brand/run-wordmark.svg`, `run-wordmark-dark.svg`, `run-mark.svg`, `run-mark-dark.svg`
- Modify: `package.json` (script `"gen:brand": "node tools/gates/src/brand/gen.ts"`)
- Test: `tools/gates/test/brand-svg.test.ts`

**Interfaces:**
- `interface BrandColours { readonly ink: string; readonly blue: string }`
- `wordmarkSvg(g: WordmarkGeometry, c: BrandColours): string` — `<svg xmlns=… viewBox="-2 2 66 46" role="img" aria-label="run">` with the same five elements as `RunWordmark`, stroke/fill literal.
- `markSvg(g: WordmarkGeometry, c: BrandColours): string` — viewBox `40 12 24 32` (from `MARK_BOX`), `aria-label="run"`, the three `n` elements only.
- `BRAND_FILES: readonly { file: string; theme: 'light' | 'dark'; render: (c: BrandColours) => string }[]` — the four files above.
- `brandColours(themes: Themes): Record<'light' | 'dark', BrandColours>` reads `--ink` and `--blue`.
- Ruling: the unsuffixed files are the light theme (the spec names them without a suffix); `-dark` files carry the dark theme. Cost if wrong: four renames.

- [ ] **Step 1: Write the failing tests**:

```ts
it('each committed brand SVG matches a fresh render from the geometry and the theme tokens', () => {
  for (const f of BRAND_FILES) expect(readFileSync(join(REPO_ROOT, 'apps/web/src/brand', f.file), 'utf8'), f.file).toBe(f.render(colours[f.theme]));
});
it('light files use the light ink and blue, dark files the dark ones', () => { /* stroke="#15222c" … stroke="#7db0f5" */ });
it('the SVGs contain the wordmark path strings verbatim and no URL but the SVG namespace', () => {
  expect(wordmarkSvg(WORDMARK_GEOMETRY, colours.light)).toContain(`d="${WORDMARK_GEOMETRY.nArch}"`);
  expect(markSvg(WORDMARK_GEOMETRY, colours.light)).not.toContain(WORDMARK_GEOMETRY.r);
  expect(markSvg(WORDMARK_GEOMETRY, colours.light).match(/[a-z]+:\/\//g)).toEqual(['http://']);
});
it('pnpm gen:brand exists', () => { expect(pkg.scripts['gen:brand']).toBe('node tools/gates/src/brand/gen.ts'); });
```

- [ ] **Step 2: Run** `cd tools/gates && pnpm exec vitest run test/brand-svg.test.ts` — FAIL.
- [ ] **Step 3: Implement `svg.ts`, `gen.ts`, add the script, run `pnpm gen:brand`.**
- [ ] **Step 4: Run the test** — PASS. `pnpm exec tsc --noEmit -p tools/gates`.
- [ ] **Step 5: Commit** `Generate the standalone wordmark and mark SVGs per theme`.

### Task 4: The top bar lockup

**Files:**
- Create: `apps/web/src/brand/BrandLockup.ts`
- Modify: `apps/web/src/workspace/AppShell.ts:196` (use `BrandLockup`)
- Modify: `apps/web/src/styles/workspace.css` lines 141-144 and 767
- Test: `apps/web/test/brand.test.ts` (new `describe('BrandLockup')`)

**Interfaces:**
- `BrandLockup(): ComponentChild` — `a.brand[href="/"]` containing the crosshair `svg.crosshair[aria-hidden]` (today's paths), `strong` "Synthetos", and `span.brand-run` wrapping `RunWordmark({ height: 27, label: 'Run' })`.
- CSS: `.brand .crosshair { width: 24px; height: 24px; color: var(--blue) }` replaces `.brand svg`; `.brand-run { display: flex; color: var(--ink); }` with `.brand-run svg { height: 27px; margin-top: 2px }` tuned so the letters' x-height (24 of 46 viewBox units) sits on the cap height of "Synthetos" (20 px condensed, cap height ≈ 14 px); the phone rule `.brand-run { display: none }` stays; `.brand svg` at the breakpoint becomes `.brand .crosshair`.

- [ ] **Step 1: Write the failing test**:

```ts
describe('BrandLockup', () => {
  it('is one link named Synthetos Run: hidden crosshair, the name, the wordmark in place of the grey text', () => {
    const a = root(h(BrandLockup, null));
    expect(a.tag).toBe('a'); expect(a.props['href']).toBe('/'); expect(a.props['class']).toBe('brand');
    const [crosshair, name, run] = a.children as El[];
    expect(crosshair.props).toMatchObject({ 'aria-hidden': 'true', class: 'crosshair' });
    expect(text(name)).toBe('Synthetos');
    expect(run.props['class']).toBe('brand-run');
    const wordmark = one(run, byAttr('role', 'img'));
    expect(wordmark.props['aria-label']).toBe('Run');
    expect(text(run)).toBe('');
  });
});
```

- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run test/brand.test.ts` — FAIL.
- [ ] **Step 3: Implement `BrandLockup`, replace the markup in `TopBar`, adjust the CSS.**
- [ ] **Step 4: Run** `test/brand.test.ts test/appShellGate.test.ts test/shell.test.ts` — PASS; `pnpm exec tsc --noEmit -p apps/web`; `pnpm exec eslint apps/web/src/brand apps/web/src/workspace/AppShell.ts apps/web/test/brand.test.ts`; `pnpm exec depcruise apps/web/src --config .dependency-cruiser.cjs`.
- [ ] **Step 5: Commit** `Show the run wordmark in the top bar lockup`.

### Task 5: README

**Files:**
- Modify: `README.md` (a `<picture>` block above the first heading)

- [ ] **Step 1: Add**

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/src/brand/run-wordmark-dark.svg">
  <img alt="run" src="apps/web/src/brand/run-wordmark.svg" height="64">
</picture>
```

- [ ] **Step 2: Verify** `cd tools/gates && pnpm exec vitest run test/doc-drift.test.ts` — PASS (the status block regex still matches).
- [ ] **Step 3: Commit** `Show the wordmark at the top of the README`.

### Task 6: Walkthrough: browser test, screenshots, doc

**Files:**
- Create: `tools/e2e/specs/logo-placements.e2e.ts`
- Create: `docs/design/LOGO_PLACEMENTS.md`, `docs/design/screenshots/logo-placements/*.png`

**Test (signed-in session stub so no gate):** for each theme, `goto('/')`, `ready`; `expect(page.getByRole('link', { name: 'Synthetos Run' })).toBeVisible()`; the wordmark `.brand-run svg` is visible at 1280 and hidden at 320; `link[rel=icon][sizes="32x32"]` href is `/icons/icon-32.png`; screenshots `topbar-{theme}-{width}.png` (`.topbar` element) when `RUN_SCREENSHOTS=1`. One test renders the icons: `page.setContent` with `<img>` tags to `${baseURL}/icons/icon-32.png` (at 32 px and 128 px) and `icon-192.png`, screenshot `tab-icon.png`. One test stubs a signed-out session and screenshots `gate-light-1280.png` to show the dialog unchanged.

- [ ] **Step 1: Write the spec; run it before the build to see it fail** (`cd tools/e2e && pnpm exec playwright test specs/logo-placements.e2e.ts` against the old dist, which lacks `.brand-run svg`). Check port 8790 is free first.
- [ ] **Step 2: `pnpm build && cd tools/e2e && RUN_SCREENSHOTS=1 pnpm exec playwright test specs/logo-placements.e2e.ts`** — PASS, pictures written. Look at each picture; tune the wordmark height/offset in Task 4's CSS if the baseline is off and re-shoot.
- [ ] **Step 3: Write `docs/design/LOGO_PLACEMENTS.md`**: what a visitor sees (top bar, tab, README), the file table from spec §4 with where each asset lives, the per-theme ruling, how to regenerate (`pnpm gen:icons`, `pnpm gen:brand`), the screenshot table, and the unit tests that pin the shared geometry.
- [ ] **Step 4: Lint** `pnpm exec eslint tools/e2e/specs/logo-placements.e2e.ts`.
- [ ] **Step 5: Commit** `Add the logo placements walkthrough and its browser test`.
