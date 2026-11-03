<!--
Pull request template for synthetos/run (ROADMAP P0-03, SAFETY §8).

The "Safety review checklist" section is REQUIRED when this PR touches any
safety-review path (tools/gates/src/shared/safetyPaths.ts: machine, protocol,
safety, flasher, schema, testkit, jog/control/firmware UI, the machine
workers, the cloud client and loaders, the run Worker headers, SAFETY.md,
firmware and safety data, the vendored HIL tables, the CI gates and the
supply-chain files). The `safety-review` check then fails until every item
is ticked and the PR commits its recorded independent review as
docs/safety/reviews/pr-<N>.md, bound to the head (D40; the format is in
docs/safety/reviews/README.md), plus the approvals
tools/gates/src/review/reviewPolicy.ts requires (none while there is a
single maintainer, two once a second one joins). Tick an item that does not
apply only after checking that it does not, and say why under "Notes for
the safety reviewer".

Do not reword, renumber or delete items: the check reads them by number.
-->

## What and why

## How it was tested

## Safety review checklist (SAFETY §8)

Items 1–21 are OLD-S §8 as SAFETY §8 adopts them ("sim" read as `testkit`;
item 20 covers 0x18 and 0x04). Items 22–40 are SAFETY §8 verbatim.

- [ ] 1. No new code path writes to a Transport except through `MachineSession`.
- [ ] 2. No mid-line abort. One complete line per awaited write. No newline after a failure.
- [ ] 3. Every new intent goes through `safety.allowed`, and the generated allow-matrix test has been updated: no unclassified (state × overlay × intent) cells.
- [ ] 4. Machine state shown in the UI comes from firmware reports only. Nothing optimistic.
- [ ] 5. Every timed wait has a timeout and an escalation path that reaches W12 or FAULT.
- [ ] 6. No auto-resume, auto-reconnect-and-continue, or automatic resend.
- [ ] 7. New bytes sent to the board cannot include `! ~ %` or control bytes in data, cannot start with `$ ? H h {` in job data, and respect line limits. The sanitiser properties still pass.
- [ ] 8. Dialect differences are expressed in dialect or board data, not `if` branches, and table snapshots are updated with citations.
- [ ] 9. Every protocol or hardware claim cites a firmware file and line, or is marked UNVERIFIED with a bench task. The test kit behaviour carries the same status.
- [ ] 10. Settings writes go through the §4.6 pipeline (G21 acknowledged, read-back, units restored, invalidation).
- [ ] 11. Jog changes keep one-in-flight and bounded, time-capped moves.
- [ ] 12. Flash changes keep stub-vector ordering, commit-after-verify, the guard filter and the identity gate. The disconnect-at-every-Nth-byte test passes.
- [ ] 13. Warnings and confirmations in §5 and §6 are unchanged, or `SAFETY.md` is updated in the same PR.
- [ ] 14. No new runtime dependency in `protocol`, `safety` or `machine`. Any dependency change is reviewed and licence-allowed.
- [ ] 15. CSP and Trusted Types are not loosened. No inline script, no third-party origins.
- [ ] 16. Stop latency budget (<100 ms) and the "stop visible and focusable in every state" E2E tests pass.
- [ ] 17. Stryker score on touched safety-path packages is ≥ 90%. `safety` branch coverage is 100%.
- [ ] 18. If the change affects motion or flashing behaviour on hardware, a HIL checklist run is scheduled before release.
- [ ] 19. Preview/preflight interpret the sanitised byte stream with dialect semantics (comments, G10 L, M6, M0), not the original file.
- [ ] 20. No new code path emits 0x18 except the `resetController` intent (T-S26), or 0x04 except the intents named in SAFETY §3 and §4 (item 29). Realtime bytes are not gated by XOFF.
- [ ] 21. Any new persisted write (settings, offsets, normalisation, temporary travel) has a snapshot-and-restore path and a next-connect recovery (H24, H26).
- [ ] 22. No network API identifier is used in `protocol`, `safety`, `machine` or `flasher`, and nothing in those packages imports `contracts` or `apps/web/src/cloud`.
- [ ] 23. No code path applies a stored profile, wiring-derived setting or settings backup without C19 or C5 and the write pipeline.
- [ ] 24. Nothing uploads facts, confirmations, overrides, acknowledgements or pending-restore records. The sync schema is unchanged, or this document is updated in the same PR.
- [ ] 25. Library jobs are loaded fully and hash-verified before Arm. No code streams from the network.
- [ ] 26. Sign-out, account switching and deletion of the armed file are denied while LIVE. No sync UI appears over the safety chrome while LIVE.
- [ ] 27. All reads go through the per-dialect allowlist. No new readable token is added without review.
- [ ] 28. Dialect selection uses the capability probe and manifest, not `fb` alone.
- [ ] 29. ^D (0x04) and ENQ (0x05) are emitted only on `tinyg-en` and only by the intents named in §3 and §4.
- [ ] 30. Program stops are host barriers on every TinyG dialect. The final M2/M30 holdback is intact.
- [ ] 31. The test kit is not reachable from any production entry (dependency rule plus bundle scan).
- [ ] 32. API changes keep the CSRF rules (Origin, custom header, JSON only, no CORS) and scope every query by the session's user id.
- [ ] 33. Feedhold, Stop job and Spindle off now stay allowed in every connected overlay; the allow-matrix generator (T-S62) passes.
- [ ] 34. No user-visible string calls a hold "STOPPED"; the pause control carries W2.
- [ ] 35. Every check that needs `stat`, `vel`, `hold`, `qr` or `mpo` uses polled reads with `tid`, not filtered status reports.
- [ ] 36. Every new profile field is classified (firmware setting, host gate, descriptive), and host-gate loosening goes through C19.
- [ ] 37. Provenance fields are server-written; no API accepts a client-supplied `created_by_*`, `device_id` or `taken_at`.
- [ ] 38. No sanitised line can queue more than the queued-motion ceiling.
- [ ] 39. The connect sequence writes `{"sr":null}` first and no ENQ before a footer revision 2/3 (H49, PN §2.3).
- [ ] 40. Console (MDI) motion and spindle-on lines go through preflight, the ceiling and the target confirmation; no console path writes to the Transport except through `MachineSession` and `safety.allowed`.
- [ ] 41. Phase 2: every motion line matches the closed grammar of the motion command kind (§4.5b); no jog ever queues more than the lookahead; `%`, `~` and `{"clear":null}` come only from their named sequences; the motion flag stays off for the production host (T-S93).
- [ ] 42. Settings writes stay behind the phase switch (`SETTINGS_WRITES`, production off), the approval gate and the idle gate; one token per line with its answer awaited and a read-back; a backup before every apply; no forbidden, identity or communication key is writable.
- [ ] 43. (amendment 2026-11-02) Nothing polls while idle: no periodic GET, only the confirming reads §4.2 lists and one read-back per change; the full state is read at every connect; liveness comes from reports and the heartbeat (STALE after the silence window).
- [ ] 44. (amendment 2026-11-02) The status report list, `sv` and `si` are written only where they differ, one line at a time with a read-back, through the `report` kind and the `reports` release gate; never a `ram` key; the change is shown (W35, W36) and logged.
- [ ] 45. (amendment 2026-11-02) Homing, G28.3, G92/G92.1 and G54..G59 are separate intents with their confirmations (C4, C26–C29) and read-backs; each motion line kind comes only from its intents; UNKNOWN always offers its exits.
- [ ] 46. (Phase 3, 2026-11-03) Jobs stay behind the jobs switch (`JOBS`, production off) and the motion release; the job is sanitised in the worker with live values; Start needs its confirmations (homed or C36, C31, C32).
- [ ] 47. (Phase 3) Job lines go out only in line mode (footer revision 3), never beyond `f[2]` less the owed lines less the reserve; only `r` answers are counted; every job line passes the gate as exactly its sanitised line.
- [ ] 48. (Phase 3) A refused line holds the job (W38, C33); a reset is a FAULT (W40); a tool change stops before the M6 with the spindle and coolant off (W37, C34, C35); breakpoints stop before their line and say when they cannot (W41).
- [ ] 49. (Phase 3) `rxm` is written only by the `lineMode` intent: only if it differs, read back, and put back after the job, and at connect only with this browser's pending record (H77); the job flag is sent only where the capability probe finds it.

### Notes for the safety reviewer

<!-- Which items did not apply, and why. HIL items scheduled (SAFETY §9). -->

