/**
 * ROADMAP P1-03, the parts beside the wire: T-S50 (machine suggestion by
 * family and board id, never auto-selected; a different bound device is a
 * hard block), W25 for READ_ONLY sessions, and the T-S77 platform rule (no
 * live control on a mobile OS whatever `navigator.serial` reports).
 */
import type { BoundDevice } from '@synthetos/schema';
import { describe, expect, it } from 'vitest';
import { checkSelection, liveControlPlatform, readOnlyNotice, suggestMachines, type MachineCandidate, type ProbedBoard } from '../src/index.ts';

const bound = (id: string, family: BoundDevice['family'] = 'tinyg'): BoundDevice => ({
  family,
  id,
  fb: 450.01,
  dialectId: family === 'tinyg' ? 'tinyg-en' : 'g2core-edge',
});
const m = (source: 'local' | 'cloud', key: string, device: BoundDevice | null): MachineCandidate => ({ source, key, boundDevice: device });
const EN_BOARD: ProbedBoard = { dialectId: 'tinyg-en', id: '3X0000-AAA' };

describe('T-S50: suggestions by (family, board id); nothing is auto-selected', () => {
  it('two machines with the same board id: both offered, the user picks, none selected', () => {
    const s = suggestMachines(EN_BOARD, [m('local', 'a', bound('3X0000-AAA')), m('local', 'b', bound('3X0000-AAA')), m('local', 'c', bound('OTHER'))], [], false);
    expect(s.matches.map((x) => x.key)).toEqual(['a', 'b']);
    expect(s.choice).toBe('pick');
    expect(s.selected).toBeNull();
  });

  it('one match is offered for confirmation, still not selected', () => {
    const s = suggestMachines(EN_BOARD, [m('local', 'a', bound('3X0000-AAA'))], [], false);
    expect(s).toMatchObject({ choice: 'confirm', selected: null });
    expect(s.matches).toHaveLength(1);
  });

  it('cloud machines count only when signed in; a local and a cloud match together are a pick', () => {
    const local = [m('local', 'a', bound('3X0000-AAA'))];
    const cloud = [m('cloud', 'c1', bound('3X0000-AAA'))];
    expect(suggestMachines(EN_BOARD, local, cloud, false).matches.map((x) => x.key)).toEqual(['a']);
    const signedIn = suggestMachines(EN_BOARD, local, cloud, true);
    expect(signedIn.matches.map((x) => x.key)).toEqual(['a', 'c1']);
    expect(signedIn.choice).toBe('pick');
  });

  it('the family must match too; unbound machines, an unclassified board and a board with no id match nothing', () => {
    const machines = [m('local', 'g2', bound('3X0000-AAA', 'g2core')), m('local', 'u', null)];
    expect(suggestMachines(EN_BOARD, machines, [], false)).toMatchObject({ matches: [], choice: 'none', selected: null });
    const same = [m('local', 'a', bound('3X0000-AAA'))];
    expect(suggestMachines({ dialectId: null, id: '3X0000-AAA' }, same, [], false).choice).toBe('none');
    expect(suggestMachines({ dialectId: 'tinyg-en', id: undefined }, same, [], false).choice).toBe('none');
  });

  it('a machine bound to another board (or family) is a hard block; an unbound one binds; a match passes', () => {
    expect(checkSelection(EN_BOARD, m('local', 'x', bound('OTHER')))).toMatchObject({ ok: false, code: 'bound-device-differs' });
    expect(checkSelection(EN_BOARD, m('local', 'x', bound('3X0000-AAA', 'g2core')))).toMatchObject({ ok: false, code: 'bound-device-differs' });
    expect(checkSelection(EN_BOARD, m('local', 'x', null))).toEqual({ ok: true, binds: true });
    expect(checkSelection(EN_BOARD, m('local', 'x', bound('3X0000-AAA')))).toEqual({ ok: true, binds: false });
    expect(checkSelection({ dialectId: null, id: 'A' }, m('local', 'x', null))).toMatchObject({ ok: false, code: 'unclassified' });
    expect(checkSelection({ dialectId: 'tinyg-en', id: undefined }, m('local', 'x', null))).toMatchObject({ ok: false, code: 'no-board-id' });
  });
});

describe('W25 for READ_ONLY sessions', () => {
  const ro = (reason: string, upgradeOffer: boolean, fb?: number) =>
    ({
      overlays: ['READ_ONLY'],
      classification: { dialectId: 'tinyg-en', mode: 'readOnly', reason, detail: 'x', upgradeOffer },
      identity: fb === undefined ? {} : { fb },
    }) as never;

  it('names the build and a fixed reason; the upgrade advice only where offered', () => {
    expect(readOnlyNotice(ro('en-not-approved', false, 450.01))).toBe(
      "This controller's firmware (build 450.01, not an approved build) is supported read-only. You can view settings and send a feedhold, but not move the machine. Use your usual sender.",
    );
    expect(readOnlyNotice(ro('tg440-not-approved', true, 440.21))).toContain('(build 440.21, TinyG 440.21, not yet approved for control)');
    expect(readOnlyNotice(ro('tg440-not-approved', true, 440.21))).toMatch(/Upgrade to the approved TinyG firmware\.$/);
    expect(readOnlyNotice(ro('flowControl', false, 450.01))).toContain('RTS/CTS flow control (ex=2)');
    expect(readOnlyNotice(ro('probeFailed', false))).toContain('(build unknown, its identity could not be read)');
  });

  it('null when the session is not READ_ONLY', () => {
    expect(readOnlyNotice({ overlays: [], classification: null, identity: null })).toBeNull();
    expect(
      readOnlyNotice({ overlays: [], classification: { dialectId: 'tinyg-en', mode: 'full', reason: 'en-approved', detail: '', upgradeOffer: false }, identity: { fb: 450.01 } }),
    ).toBeNull();
  });
});

describe('T-S77: no live control on a mobile OS, whatever navigator.serial reports', () => {
  const DESKTOP: readonly [string, string, string] = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36',
  ];
  const MOBILE = [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ];

  it('desktop Windows, macOS and Linux are allowed', () => {
    for (const userAgent of DESKTOP) expect(liveControlPlatform({ userAgent, maxTouchPoints: 0 }), userAgent).toEqual({ allowed: true });
    expect(liveControlPlatform({ userAgent: '', userAgentData: { mobile: false, platform: 'Windows' } })).toEqual({ allowed: true });
  });

  it('Android phones and tablets, iPhone and iPad are refused, also with a desktop-looking user agent', () => {
    for (const userAgent of MOBILE) expect(liveControlPlatform({ userAgent }), userAgent).toMatchObject({ allowed: false, code: 'mobile-os' });
    // Android "desktop site" mode: the UA looks like Linux, the client hints still say Android / mobile.
    expect(liveControlPlatform({ userAgent: DESKTOP[2], userAgentData: { mobile: false, platform: 'Android' } })).toMatchObject({ code: 'mobile-os' });
    expect(liveControlPlatform({ userAgent: DESKTOP[0], userAgentData: { mobile: true, platform: 'Windows' } })).toMatchObject({ code: 'mobile-os' });
    // iPadOS reports a Macintosh UA; it is the only touch "Mac".
    expect(liveControlPlatform({ userAgent: DESKTOP[1], maxTouchPoints: 5 })).toMatchObject({ code: 'mobile-os' });
  });

  it('ChromeOS waits for its review; an unknown OS is refused (fail closed)', () => {
    expect(liveControlPlatform({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' })).toMatchObject({ code: 'chromeos' });
    expect(liveControlPlatform({ userAgent: '', userAgentData: { platform: 'Chrome OS' } })).toMatchObject({ code: 'chromeos' });
    expect(liveControlPlatform({ userAgent: 'Mozilla/5.0 (FreeBSD amd64)' })).toMatchObject({ code: 'unsupported-os' });
    expect(liveControlPlatform(undefined)).toMatchObject({ code: 'unsupported-os' });
  });
});
