# IBM Plex (vendored, OFL-1.1)

Self-hosted so that no font request leaves run.synthetos.com (RUN_PLAN §6.4,
`font-src 'self'`; ROADMAP P0-04, P0-05). The files are IBM's own Latin-1
subsets from the official npm packages, copied unmodified (the Reserved Font
Name "Plex" therefore still applies to them). They are vendored files, not npm
dependencies, so nothing is installed at build time.

Licence: SIL Open Font License 1.1, `OFL.txt` (identical in all three
packages). The build also serves it at `/licenses/IBM-Plex-OFL.txt`
(`apps/web/public/licenses/`).

| File | Package (npm dist.integrity) | sha256 |
|---|---|---|
| IBMPlexSans-Regular-Latin1.woff2 | @ibm/plex-sans@1.1.0 | b5ad7bd39f996144915f0ad9849a90183b27d8c28ad97ed98af5b1bebc51f6b1 |
| IBMPlexSans-Medium-Latin1.woff2 | @ibm/plex-sans@1.1.0 | b5610af04d0d4b5a14a621d96d974b993e945a065db1a8861918f69ef9321934 |
| IBMPlexSans-SemiBold-Latin1.woff2 | @ibm/plex-sans@1.1.0 | fff0ab3a88b0b4aa0b693e4f0201359a15183b08e3fa5696d1918d8f0ade8ad5 |
| IBMPlexSansCondensed-Medium-Latin1.woff2 | @ibm/plex-sans-condensed@2.0.0 | 77566d36b1dea360fcdadfa87766cea062d917d73bf7e6e3f52ca4b35edf405d |
| IBMPlexSansCondensed-SemiBold-Latin1.woff2 | @ibm/plex-sans-condensed@2.0.0 | 6738b1096fd433204a070db0b4a9b1172ad3e6bdff8aad5f05f7351e7c157d06 |
| IBMPlexSansCondensed-Bold-Latin1.woff2 | @ibm/plex-sans-condensed@2.0.0 | 765b0d6c8ef4a4feb02505474818e0fb9e44ce9ae206ef20dfe617de089f4b34 |
| IBMPlexMono-Regular-Latin1.woff2 | @ibm/plex-mono@2.5.0 | e8993d946649b9d01abb1ed06d574b19d8ea3e66b5c3948602db335c44c18e56 |
| IBMPlexMono-Medium-Latin1.woff2 | @ibm/plex-mono@2.5.0 | 41201b658a328b9d00368215c2f1102770f80b15952ab82631e4006255e6365d |
| OFL.txt | (LICENSE.txt of each package) | 7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da |

Package integrity (npm registry `dist.integrity`):
- `@ibm/plex-sans@1.1.0`: `sha512-WPgvO6Yfj2w5YbhyAr1tv95RUz4LRJlqN+CmYvBglabXteufP1D1E9BABMde+ZIKdRbFJDoKF5eQzfhpnbgZcQ==`
- `@ibm/plex-mono@2.5.0`: `sha512-STBJIPxPomOYPmBMO7z5TKPJUotAF9u3gAUumTqVgwgrAO+K4FRNh0MlhsoJjKhJKsMbBJR10/bk4inkj/wc1w==`
- `@ibm/plex-sans-condensed@2.0.0`: `sha512-dzgR4Npf/JJMiTYf6iOBQJpTDQfllZFLN0A0FkW5gtWhNr9JeQNvRrIRwJvbZHfL0I8wae8kIhO/ukYdeXW54g==`

Files are under `fonts/split/woff2/` in each package. `test/fonts.test.ts`
checks every hash above, so a changed file fails CI. P0-05 may add or
re-subset weights; update this table and the test together.
