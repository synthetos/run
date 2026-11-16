# Projects

The owner's direction (2026-11-02): the Projects page has a way to:
- create new projects;
- upload files (G-code and similar, with a size cap);
- record project information, links and images;
- share a project to the forum, perhaps as "Show and tell".

## 1. What a project holds

| Field | Notes |
|---|---|
| `id`, `name`, `description` | The description is plain text with simple formatting (paragraphs, lists, links), rendered safely |
| `cover`, `images[]` | JPEG/PNG/WebP, re-encoded locally to WebP and scaled down to at most 2000 px, with location (EXIF) metadata removed |
| `files[]` | Each file has a role: G-code (`.nc .gcode .ngc .tap .txt`), DXF/SVG (fixtures and drawings), STL/STEP (models, stored only, not previewed), or other. Each file records its size, a hash, the date added and the user's note |
| `links[]` | Title plus an http(s) URL, shown through `safeExternalLink` |
| `setup` | References to the machine, stock, material and tools used, each with its version, so a project shows exactly how it was cut |
| `jobs[]` (P3) | Run history: file, start and end time, outcome, notes, achieved against programmed feed |
| `tags[]`, `createdAt`, `updatedAt` | |

## 2. Limits

- **Per file:** 50 MB for G-code (about 1M+ lines; the preview's limit is already about 1M segments), 20 MB for any other file, 10 MB per image before re-encoding.
- **Per project:** 500 MB stored locally, within the browser quota. The page shows usage and asks before going over.
- **Cloud (Stage 2):** per-account quota (owner decision), kept in R2 under the account. Files are content-addressed, so a G-code shared between projects is stored once.

## 3. Phases

- **Stage 1 polish (local):** create, rename and delete projects; upload by drag-and-drop or picker; images, links and the description; "Open in Run" for any G-code file. Everything is stored in IndexedDB behind the storage module.
- **Stage 2 (cloud, in progress):** account sync for project records and content-addressed files/images, with on-demand verified downloads, one browser-copy prompt and keep-both conflicts. Project zip download and import are implemented (step 3c); production storage remains gated.
- **P3:** job history is filled in automatically when jobs run.

**Download/import:** Download project writes an uncompressed `.zip` with `project.json`,
`files/<id>/<original name>` and `images/<id>.webp`. Local bytes work offline; missing
account files download and verify first. Import project validates the record, CRC,
SHA-256, file sizes and still WebP images before publishing anything. It refuses unsafe
paths, unlisted or missing files, compressed/encrypted archives, more than 1000 entries,
and data beyond the 500 MB project limit or each file/image limit. The record is capped
at 1 MB. An existing project id becomes a new project named “(imported)”; file ids stay
stable and jobs follow the new project id. Different bytes cannot overwrite an existing
file id. Imported bytes are stored once per hash; shared copies keep their bytes when
another project is deleted. Account imports use the normal file-before-record sync.
Imported project ids must match the account record id contract (1–64 lowercase ASCII
letters, digits, dots, underscores or hyphens, starting with a letter or digit); other
ids are refused before installation. Every imported job and its nested file reference
are bound to the containing project, including imports without an id collision.

## 4. Sharing to the forum ("Show and tell")

- **"Share to forum"** opens a pre-filled forum post in the **Show and tell** category. The category is created if it doesn't exist; that's an owner decision. The post has:
  - the title;
  - the description;
  - the cover and up to 6 images;
  - a setup summary: machine, material, tools, and the feeds/speeds used;
  - a link back to the project.
- **The user picks what to include.** Everything is previewed first, as with REPORT_A_PROBLEM §4. G-code is never shared without an explicit tick, because files can be someone's paid or private design.
- **Images** need hosting the forum can show. Use the forum's own image upload when the composer supports it; otherwise R2 media under the account (Stage 2). The CSP stays strict: images come only from our own hosts.
- **Public project pages (later):** a read-only page for a shared project, with an optional G-code download if the owner of the project allows it. Forum posts link to it.
- **Phase:** sharing needs the account (Stage 2). In Stage 1 the button shows "Sharing arrives with your Synthetos account".
