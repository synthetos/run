# Safety documents in this repository

- `/SAFETY.md` is the safety case: a copy of `docs/run/SAFETY.md` from
  `synthetos/synthetos.com` at `53a8af1ffe6c8bfa1e1b9315fd10fcc220e029a3`.
- `OLD-S.md` is a verbatim copy of `docs/tools/SAFETY.md` from the same
  commit. SAFETY.md cites it as OLD-S, and several of its §6 confirmations are
  defined as "As OLD-S Cn" (C3, C4 from Phase 4, C6's boxes, C9, C12, C15,
  C17). Their exact wording is OLD-S §6, so T-S32
  (`packages/safety/test/strings.test.ts`) checks those strings against this
  file. Do not edit it: replace it with a newer verbatim copy if the source
  changes, and update this note.

Both files are read by tests. A change to either needs safety-path review.
