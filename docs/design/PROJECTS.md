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
- **Stage 2 (cloud):** sync to the account, plus a "Download project" zip and an import.
- **P3:** job history is filled in automatically when jobs run.

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
