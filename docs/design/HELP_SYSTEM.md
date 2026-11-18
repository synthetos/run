# The help system: where it starts

The owner held the learning system (tutorials, help pages, "Show me" spotlights) as its own later project
(2026-11-16). This note records the one piece that already exists so the later project builds on it rather than
beside it: the "More to set up" list on the setup wizard's last step.

## The seed: `apps/web/src/wizard/moreTopics.ts`

One file, data only. Each row is one topic the wizard did not cover and is the seed of one future help article:

| Field | In the wizard today | In a help article later |
|---|---|---|
| `id` | the row's `data-topic-go` | the article's slug and URL (`/help/<id>/`) |
| `title` | the collapsed row's summary | the article title |
| `lines` | two or three short sentences shown when the row expands | the article's summary, shown in search results and at the top of the page |
| `go` | the button that opens the place in Run where the topic is done (a view, and the Board tab when it is one) | the article's "Show me" target: the same view and tab, later a spotlight on the exact control |

Rules the rows follow, checked by `apps/web/test/moreTopics.test.ts`: two or three lines, one sentence each, at
most 22 words, a view that exists, no reassurance filler. The six first rows are the spec's (§6.3 step 7): materials
and feeds, work zero and probing, feed override, firmware backups, projects and zip export, reporting a problem.

## How it grows

- A new Run feature or a reviewed TinyG capability adds one row. The row is written when the feature lands, by the
  slice that lands it, so the list never lags the product.
- A row never explains how to do the thing. It says what the thing is and where it is done. The article does the rest.
- When the help system exists, the article body lives next to the row (a Markdown file per `id` under
  `docs/help/`), and the wizard keeps reading only the row.

## What is not built here

No help pages, no routes, no search, no spotlights, no tutorial player. The wizard renders the rows; nothing else
reads them yet.
