# Onsrud catalog data

Run `node tools/catalog/generate-onsrud.mjs` from the repository root. The input
is the researched snapshot supplied on 2026-11-12; each record carries product
and specification URLs and each cutting row carries its PDF and printed page.
The generator does not access the network. Generated data is bundled only into the run Worker. The public same-origin
`GET /api/catalog/tools` returns a content-hash version and ETag; it is never
imported into the web bundle. The browser validates and freezes each template
with readTool after fetching through its cloud client.

Lengths use the source decimal inches times exactly 25.4. Original fractions
and approximate helix descriptions stay in notes. No coating is stated, so the
records use uncoated. Stickout is holder-dependent and remains absent.

Chipload `fz` and optional `fzMax` store the published lower and upper bounds in
mm/tooth, using exactly 25.4 mm/in. The cutting table displays the range in the
selected unit, with no long per-row note except the uncertain-value warning.
Source page means PDF page, not printed page; links jump there. The original
published ranges and printed-page locators remain in the research snapshot.
The chart basis of 1 × diameter is noted, not invented as a recommended depth.
Surface speed, axial depth, radial engagement and coolant are optional and absent
when unpublished. An advisor cannot construct a complete tool-specific target
from a row without surface speed and uses its existing material model instead.

Manufacturer material categories have their own `onsrud.*` references and display
names. They are not silently mapped to particular alloys or plastic grades.
Uncertain laminated-board rows visibly warn that the source may be misprinted.
The complete research notes, including generic RPM boxes not attributed to a
series and wood-data gaps for 52-200B, are retained in the input snapshot. None
of those values are filled from another series. Material icons are not cutting
recommendations. Catalog templates become user records only through Add tool.

The catalog view fetches only when its tab is active. Failed requests or invalid
records show the connection message and Retry; local My tools remains independent.
The Worker route allows GET only, rejects cross-origin request metadata, and uses
`public, max-age=3600` with an ETag. No account or RUN_DATA binding is involved.
Its flat generated module is included automatically in the twice-built Worker
archive, so neither build-policy exceptions nor web bundle-scan exceptions are
needed. Source/data tests live under workers/run/test; schema-only checks remain
in packages/library/test/validate.test.ts.
