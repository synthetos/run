# TinyG 450.05 Part A

The staging candidate is tag `450.05`, commit `0e80716961577c99fa5b8269ec2fadf160161b50`.
The release hex is 502955 bytes, SHA-256 `20f231be49491ad856766dd377ae7524a1faf9b1d40f7845a18fb24fc22bb2d6`.
The local release asset was hashed before preparing the manifest.

The schema and read allowlist select the 450.05 delta using the probed build, with the capability probe and signed approval still required. The three output-pause keys are absent. Override keys are readable but have no write overlay; Run still refuses them. Restore excludes removed hold keys and explains the omission in its summary. The conservative dwell ledger stays enabled, including with N99's Run status.

The testkit profile is `build: { fb: 450.05, fv: 0.97, hv: 8, layout: 10003 }`. It models motion-only hold, layout migration from known markers, and N99 dwell status. Override GETs expose reset defaults (`mcp=0`, the other five keys `1`); override SETs explicitly raise a model gap. It does not simulate live override planning or migration power cuts.

## Signing handoff

No signing was performed. The staging payload in `firmware/releases.json`, its unsigned input, and the proxy asset table are prepared. The old signature is deliberately stale. The bench approval unsigned input is prepared; `approved-builds.json` is unchanged. Production inputs and signed channels are unchanged.

The repository commands, run by the bench-key holder, are:

```sh
pnpm sign:releases --key /absolute/path/outside/repo/bench.pkcs8.pem --kid owner-bench-2026-11-02
pnpm sign:builds --key /absolute/path/outside/repo/bench.pkcs8.pem --kid owner-bench-2026-11-02
```

`sign:releases` reads `firmware/releases.unsigned.json`, writes `firmware/releases.json`, and regenerates `workers/run/src/firmwareAssets.ts`. Its input currently contains staging only.

**`sign:builds` signs every channel**, including the empty production channel. Save the existing production signed channel before invoking it, then restore that exact channel afterward; only the bench channel may change in this handoff. Do not replace production with a bench-key signature. The private key must remain outside the repository. No new CLI flags are implied here.

Until signing, the six firmwareHub tests that verify the committed staging release list fail closed. After signing, rerun those tests and the release/approval gates before any staging rollout.

## Not included

Live override controls and writes, and job-file M48/M49/M50 support, remain for Part B. The existing parser continues to reject those program codes. N108's improved group reads in alarm require no new host write path. No production approval, release pin change, push, dispatch, deploy or real-board operation is part of this commit.
