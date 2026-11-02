# Safety documents in this repository

- `/SAFETY.md` is the safety case: a copy of `docs/run/SAFETY.md` from
  `synthetos/synthetos.com` at `f2760cd2d70f5887efd607ef8e59e52a1cd4285f`
  (the D1 "sign-in required" wording, including W22), plus the amendments
  made in the Phase 0 review, each marked "Amended in P0 review" in the text
  (§4.3 time estimate, F units and rotary axes; §4.4 EN Stop job steps 1 and
  3; §4.7 step 6a). Those amendments are not yet in the synthetos.com copy:
  carry them upstream, then re-copy, so the two stay identical
  (docs/safety/PHASE0_TRACEABILITY.md).
- `OLD-S.md` is a verbatim copy of `docs/tools/SAFETY.md` from the same
  commit. SAFETY.md cites it as OLD-S, and several of its §6 confirmations are
  defined as "As OLD-S Cn" (C3, C4 from Phase 4, C6's boxes, C9, C12, C15,
  C17). Their exact wording is OLD-S §6, so T-S32
  (`packages/safety/test/strings.test.ts`) checks those strings against this
  file. Do not edit it: replace it with a newer verbatim copy if the source
  changes, and update this note.

Later in-repo changes to `/SAFETY.md`, also to carry upstream: the
2026-11-02 bench amendments to H49 (marked "Amended 2026-11-02"), and on the
2026-11-02 re-pin to edge-next `97321391` the EN `file:line` citations that
moved (the text they cite is unchanged).

Both files are read by tests. A change to either needs safety-path review.
