# Independent safety reviews (D40)

DECISIONS D40 (owner, 2026-11-01): while the owner is the only maintainer,
required approvals on GitHub are zero, because GitHub never lets authors
approve their own pull requests. Every pull request that touches a
safety-review path (`tools/gates/src/shared/safetyPaths.ts`) instead
commits a recorded independent review here, as `pr-<N>.md`, where `<N>` is
the pull request number. The required `safety-review` check refuses the PR
without it (`tools/gates/src/review/reviewRecord.ts`,
`docs/ops/branch-protection.md` §1).

## How to record a review

1. Push the change. Note the commit to be reviewed (normally the PR head).
2. Have it reviewed by someone, or something, independent of the author: a
   second person, or a separate review agent run outside the author's
   session that re-runs its own reproductions. Resolve every finding; a
   finding that changes code means a new commit and a new review of it.
3. Commit `docs/safety/reviews/pr-<N>.md` **as the only change after the
   reviewed commit**, in this shape (field names exact, one of each):

```md
# Independent safety review: PR #<N>

- PR: <N>
- Reviewed commit: <the full 40-character sha that was reviewed>
- Reviewer: <who reviewed it; never the PR author's login>
- Verdict: approve
- Open findings: none

## Safety paths reviewed

- <every safety-review path the PR touches, one per line, as GitHub lists it>

## Notes

<what was checked, each finding and how it was resolved, what was re-run>
```

The check reads the record at the PR head and asks GitHub to compare the
reviewed commit with the head. It passes only when the head is strictly
ahead of the reviewed commit and the record is the only file changed after
it, so what merges is exactly what was reviewed plus the record. Pushing
anything else afterwards, or merging `main` into the branch, needs a new
review and an updated record.

## What the record is and is not

It is an auditable statement kept with the change: what was reviewed, by
whom, against which commit and with what result. It is not an identity
check; with one maintainer nothing on GitHub can prove who wrote it. D40
accepts that. The required status checks, the attested artifact, the
protected `production` environment and CODEOWNERS carry the rest, and the
two-approval rule returns, by a one-line change in
`tools/gates/src/review/reviewPolicy.ts`, when a second maintainer joins.

The record is required under that rule too, so a safety-path change always
has its review written down.
