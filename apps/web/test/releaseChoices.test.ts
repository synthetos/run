import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { verifyFirmwareReleases } from '@synthetos/protocol';
import { ReleaseChoices } from '../src/update/ReleaseChoices.ts';
import { FirmwareReleaseList } from '../src/workspace/views/FirmwareReleaseList.ts';
const row = { repo: 'synthetos/TinyG', tag: '450.07', file: 'tinyg-450.07.hex', date: '2026-11-15T00:00:00Z', notes: '<img src=x onerror=alert(1)>', prerelease: true, sha256: null, size: 10, unavailable: 'GitHub did not provide a SHA-256 digest.' };
it('both release views escape GitHub notes, label prereleases and unknown control support, and disable missing digests', async () => {
  const verdict = await verifyFirmwareReleases({ format: 'synthetos-run/github-releases@1', releases: [row] }, { environment: 'staging', now: new Date() });
  if (!verdict.ok) throw Error('bad fixture');
  const pick = () => undefined;
  const hub = { releases: { ok: true as const, list: verdict.releases } } as Parameters<typeof FirmwareReleaseList>[0]['hub'];
  const views = [
    renderToString(h(ReleaseChoices, { list: verdict.releases.boards[0]!, failure: null, blocked: null, busy: false, pick })),
    renderToString(h(FirmwareReleaseList, { hub, shown: { fb: 450.06, hv: 8, kind: 'live' }, advanced: true, focusRelease: null, blocked: null, running: false, fetching: false, enabled: true, pick, pickLocal: pick })),
  ];
  for (const html of views) {
    expect(html).toContain('Pre-release');
    expect(html).toContain('2026-11-15');
    expect(html).toContain('Run will connect read-only to this version until Run is updated.');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('GitHub did not provide a SHA-256 digest.');
  }
});

it('an older release Run reads only as read-only still carries the downgrade note (safety text) in the compact rows', async () => {
  const older = { ...row, tag: '440.21', file: 'tinyg-440.21.hex', notes: 'older build', sha256: 'a'.repeat(64), unavailable: null };
  const verdict = await verifyFirmwareReleases({ format: 'synthetos-run/github-releases@1', releases: [older] }, { environment: 'staging', now: new Date() });
  if (!verdict.ok) throw Error('bad fixture');
  const hub = { releases: { ok: true as const, list: verdict.releases } } as Parameters<typeof FirmwareReleaseList>[0]['hub'];
  const pick = () => undefined;
  const html = renderToString(h(FirmwareReleaseList, { hub, shown: { fb: 450.02, hv: 8, kind: 'live' }, advanced: false, focusRelease: null, blocked: null, running: false, fetching: false, enabled: true, pick, pickLocal: pick }));
  expect(html).toContain('data-release-note="downgrade"');
  expect(html).toContain('Run will connect read-only to this version until Run is updated.');
});
