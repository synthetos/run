# Planner timing fixtures (TinyG 450.02, host replay)

Copied read-only from TG Firmware's tree on 2026-11-10. Do not edit: the conformance test (test/planner.test.ts) checks these hashes.

- Fixtures and profiles: TinyG-worktrees/timing-fixtures/tests/hil/fixtures/planner_timing (worktree HEAD 6f5cdba5).
- Results: TinyG-work/planner-timing/450.02-{bench1,belt_xy_shapeoko2}.json (schema 1, firmware a7489b79, planner sources_sha256 cc87325c91799513035e665cf697552783794abb61cbd6dbd0112c22f5a6abdf). The edge-next (98e53eeb) results have the same durations for every file.
- Fixture 21 (dense CAM excerpt) is left out, and its entries are removed from the copied results: it is an excerpt of the owner's own design and this repository is public. The test runs it only when PLANNER_FIXTURE_21 points at TG's copy.
- Original result hashes: 450.02-bench1.json 6f0200cb769bf8c50096b3860b98588cfa442a788276c94e28aad501cf952cd5, 450.02-belt_xy_shapeoko2.json ae40093e6fedc585bbe2286798ad3e74f5c3874679ff3ff2ab34822b4cd289e9.

Copied files:

```
d8db7006df1a044653b1a689aa2aaad9e0e0e9f0332c6f2fbaa87c3eca64db57  ./nc/01_long_straight_x.nc
b320048b508cd701e0b78499a4bd0a97d4bf66f596357e346dbf2c04d61ca52b  ./nc/02_long_straight_z.nc
27b7c1c6fa77263875691179181336c476cf0154745dd1c4b361d269f2d741ec  ./nc/03_reversals.nc
e9b1e01fba51d3167744bd378d7b7c84687039984990112d0f1356066794a6ed  ./nc/04_diag_unequal.nc
593e7813ba1f0942bd064fb2b528e650b0205c8dc643b0e4c8b1e6a5d211ffed  ./nc/05_tiny_collinear.nc
62420821b5412b6bc76706a94b68a307388499c8de22368b331e4f88e0e45037  ./nc/06_tiny_high_feed.nc
dbacd4c1f2add8630b4b73908d8d1bbb77ed4efb6872e9b79b3ea13fc45d3529  ./nc/07_corners_90.nc
7072e56df96bdad641f628400cf2b7720db3799fd046264a24cc1ce965a1f670  ./nc/08_corners_45_135.nc
0b29c6ce7521e6921ab88ff1d652a15edbdbb76386f16b5e7dedc4527a8b7439  ./nc/09_arcs.nc
e0c03e7b48c7fa0e314e1f22ad96a47c7c51830e3ba0b9e9db92a0fc0c716b5f  ./nc/10_helix.nc
a4b7ab63de96cce7cd135a383e3c66f2e1a60681c864ff41b4bb715b279f844c  ./nc/11_short_arcs.nc
96fb24f21f448c344a3eee6ffc9d71b90c8db7496cacbd6f5e0510a1bce43966  ./nc/12_units_g20.nc
66813591f004db582a2e2dc6544fffcaaaab906092bb20b91e79597e663f7a0f  ./nc/13_exact_stop.nc
302affbfa45805e860ca8a017f829b7692d57414697b4ab03abff388d6f74fd9  ./nc/14_feed_changes.nc
3d6dd3ecc5ac291eae8208321178c8a7706b56b65f268218c1ea087f9121ecf5  ./nc/15_spindle_coolant.nc
a8535b9b6efb6cee319d13e113bba241320dd3bced5c66a932bf5575f90ee204  ./nc/16_dwell_midchain.nc
b26a80e4a3d31edec2ce0be1ac729e2d3dcc2e0dc4e6647788d88da4d1bcb4ac  ./nc/17_g0_vs_g1_cap.nc
71143dfa311186f14bc891d18e58081aea53653ea50fb10e3a186ae313338f8a  ./nc/18_z_ramps.nc
0cd39b053cca88fb341a8d598c47f9a5b394ffcc2199c2cd314c6d7b487ef5d2  ./nc/19_input_gaps.nc
cbb87d0bd0f490dc0e94fd67269ec54c1d88daa7002b16789b356520bae97de9  ./nc/20_hold_resume.nc
caa14720d27229d719927d8c475cfa92ffe365b37c5b03b15de15a3b35ec68b4  ./nc/22_rapids_mix.nc
b61f3c927bb2b84d9bfc530ad3ef14410353aa2b8c46f92d65c64f50373a2982  ./profiles/belt_xy_shapeoko2.json
c88a7a3e4063ed37f87afb78b676a3b9e7366e65fe11a25c1477cfc83dfb17c4  ./profiles/bench1.json
cedf600a5a07168849d6f7abe10d4c7bce8257e80e9fcfe9717a4ab271a5a078  ./results/450.02-belt_xy_shapeoko2.json
25b43b5a6fcbea3b7243a36e194a3ea97f3b6cde37cacf33f908e355232c5808  ./results/450.02-bench1.json
```
