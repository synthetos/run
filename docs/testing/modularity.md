# Modularity limits and the debt ratchet

Keep each module responsible for one job. New source files must stay within
400 code lines and functions within 80. When changing an existing oversized
file, extract the concern being changed first; do not grow the old file.
Passing numerical limits does not replace review of responsibilities or coupling.

ESLint applies these limits throughout `apps/`, `packages/`, `tools/` and
`workers/`. Design prototypes under `docs/` are outside this scope. Generated
TypeScript is included. Existing global exclusions still apply to build outputs
and dependencies.

| Metric | Limit |
| --- | --- |
| Code lines per file | 400; 600 for test/spec files |
| Code lines per function, including IIFEs | 80 |
| Cyclomatic complexity (classic) | 15 |
| Block nesting depth | 4 |
| Parameters | 4; use an options object beyond this |
| Nested callbacks, including constructor callbacks | 3 |
| Classes per file | 1 |
| Callable members per object literal or class | 15 |
| Switch cases, including default | 25 |

Line metrics exclude blank and comment-only lines. The `run/` versions of the
seven core rules wrap ESLint's pinned implementations; they do not substitute
approximate text counts. `run/oversized-structure` checks objects/classes and
switches. Methods, getters/setters, arrow/function properties and locally resolved
function references count; constructors do not. Local object spreads are followed.
Imported shorthand references count conservatively as possibly callable. Imported
spreads and dynamically constructed objects cannot be resolved by this syntax-only
rule; review must check those compositions. Dependency-cruiser's existing
`no-circular` error continues to forbid cycles.

## Exact legacy allowances

`tools/gates/modularity-baseline.json` records the initial offenders, not broader
per-file limits. Each entry is a metric plus a qualified lexical symbol and its
exact current value. File metrics use `$file`; names include lexical owners and
ordinals for repeated anonymous constructs. Depth uses the maximum within one
function. Comments and unrelated line shifts do not change identities. A renamed
or moved over-limit symbol is a new offender, not transferable debt.

- A new offender fails, even inside a file with other legacy debt.
- A larger metric fails.
- A smaller metric requires lowering its baseline value in the same change.
- Reaching the limit, removing the symbol, or removing/ignoring its file requires
  deleting the baseline entry (and the file entry if empty).

The baseline is explicitly CODEOWNERS protected. After its initial introduction,
the history gate permits only reductions/removals, across first-parent revisions
(including merge results) and the working copy. This also rejects raising the JSON
alongside code. A deliberate policy exception requires a separately reviewed policy
change; no baseline increase is authorized by feature work. Full Git history is
required; CI's verify checkout uses `fetch-depth: 0`. A shallow local clone must
fetch its history before running this gate. A source archive without Git history
cannot establish the ratchet and fails closed.

## Working on a change

Run ESLint on touched files and the targeted tests and type check. Run the
modularity gate when reducing debt:

```sh
pnpm exec eslint path/to/changed.ts
pnpm --filter @synthetos/gates exec vitest run test/modularity-baseline.test.ts
pnpm typecheck
```

ESLint diagnostics print the metric, symbol and measured value. Lower only those
entries reported as improved; remove those reported as fixed. Never regenerate a
baseline to accept new debt. The gate scans the entire configured source/test scope
so stale file entries cannot disappear unnoticed; it is also part of the normal
gates package test suite and `pnpm check`. Inline ESLint overrides remain disabled.

The initial architecture review, including the proposed split order, is delivered
to the run lead separately. Splits require that plan's approval and must preserve
existing behavior-test expectations. The review includes accounts, but this commit
installs lint enforcement only in run; accounts policy changes are separate work.
