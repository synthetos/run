/**
 * ROADMAP P1-05: LIVE entry gates. T-S17 (W6 overrides NOT CONNECTED),
 * T-S31 (a revoked, unverifiable or stale advisory refuses LIVE), T-S75 (an
 * expired cached advisory fails closed; a revocation while LIVE denies Arm,
 * Start and jog but never a running job or a stop), the D1 sign-in gate
 * (signed out: Connect refused; a mid-session identity loss changes nothing
 * in the machine path) and C1 per session (same day short, next day full;
 * HIL-1.3 simulated).
 */
import type { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { c1Full, c1Short, w6, w7 } from '@synthetos/safety';
import { ADVISORY_PAYLOAD_FORMAT, ADVISORY_SIGNING_PREFIX, SAFETY_ADVISORY_FORMAT, type ReleaseKey } from '@synthetos/protocol';
import { fetchFirmwareImage, fetchIdentity, fetchSafetyAdvisory, type AdvisoryFetch, type FirmwareImageProgress } from '../src/cloud/live.ts';
import { ADVISORY_CACHE_KEY, ADVISORY_MAX_CACHE_AGE_MS, ADVISORY_POLL_MS, AdvisoryPoller, checkAdvisory, type AdvisoryDeps } from '../src/live/advisoryGate.ts';
import {
  AuthGate,
  IDENTITY_GATED,
  NEVER_GATED,
  RUN_SESSION_PROVIDER,
  accessProvider,
  providersFor,
  type Identity,
  type IdentityProvider,
} from '../src/live/authGate.ts';
import { C1_TEXT_VERSION, c1FormFor, c1Key, recordC1 } from '../src/live/c1.ts';
import { ConnectPanel, refusalText } from '../src/live/ConnectPanel.ts';
import { memoryDeviceSafety } from '../src/live/deviceSafety.ts';
import { leaveFullscreen } from '../src/live/fullscreen.ts';
import { LiveEntry, type LiveEntryDeps, type PortChoice } from '../src/live/liveEntry.ts';
import { LiveGates } from '../src/live/liveGates.ts';
import { LIVE_MARKER_KEY, cleanDisconnect, clearLive, installLiveLifecycle, markLive, previousSessionEnded } from '../src/live/liveMarker.ts';
import { MachineStrip } from '../src/workspace/MachineStrip.ts';
import { stripStatus } from '../src/workspace/status.ts';
import { INITIAL_LIVE_VIEW } from '../src/workspace/model.ts';
import { all, byAttr, root, text } from './tree.ts';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const DAY1 = new Date(2026, 10, 1, 9, 0, 0);
const DAY1_LATE = new Date(2026, 10, 1, 23, 59, 0);
const DAY2 = new Date(2026, 10, 2, 0, 1, 0);
const PORT: PortChoice = Object.freeze({ usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 });

// ------------------------------------------------------------- signed advisory

const subtle = globalThis.crypto.subtle;
const b64 = (bytes: ArrayBuffer) => Buffer.from(new Uint8Array(bytes)).toString('base64');

async function signer() {
  const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
  const key: ReleaseKey = { kid: 't', publicKey: b64(await subtle.exportKey('raw', pair.publicKey)), environments: ['staging'], placeholder: true };
  const advisory = async (revoked: { sha: string; reason: string }[] = [], expires = '2026-12-01T00:00:00Z') => {
    const payload = JSON.stringify({ format: ADVISORY_PAYLOAD_FORMAT, env: 'staging', issued: '2026-10-01T00:00:00Z', expires, revoked });
    const sig = await subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(ADVISORY_SIGNING_PREFIX + payload));
    return { format: SAFETY_ADVISORY_FORMAT, advisories: [{ env: 'staging', kid: 't', payload, sig: b64(sig) }] };
  };
  return { keys: [key], advisory };
}

function advisoryDeps(over: Partial<AdvisoryDeps> & Pick<AdvisoryDeps, 'fetchAdvisory' | 'keys'>): AdvisoryDeps {
  return { store: memoryDeviceSafety(), environment: 'staging', appSha: SHA, now: () => DAY1, ...over };
}

const offline = (): Promise<AdvisoryFetch> => Promise.resolve({ ok: false });
const serve = (body: unknown) => (): Promise<AdvisoryFetch> => Promise.resolve({ ok: true, body });

describe('advisory gate (H27, T-S31, T-S75)', () => {
  it('a verified fetch passes and is cached as the raw signed file', async () => {
    const s = await signer();
    const file = await s.advisory();
    const store = memoryDeviceSafety();
    expect(await checkAdvisory(advisoryDeps({ fetchAdvisory: serve(file), keys: s.keys, store }))).toEqual({ ok: true, source: 'fetched' });
    expect(store.data.get(ADVISORY_CACHE_KEY)).toEqual({ file, fetchedAt: DAY1.getTime() });
  });

  it('T-S31: a revoked build, an unverifiable file, or the wrong environment refuses, and nothing is cached', async () => {
    const s = await signer();
    const store = memoryDeviceSafety();
    const revoked = await checkAdvisory(advisoryDeps({ fetchAdvisory: serve(await s.advisory([{ sha: SHA, reason: 'stop bug' }])), keys: s.keys, store }));
    expect(revoked).toMatchObject({ ok: false, reason: 'revoked', revocation: { reason: 'stop bug' } });
    expect(await checkAdvisory(advisoryDeps({ fetchAdvisory: serve({ format: 'nope' }), keys: s.keys, store }))).toMatchObject({ ok: false, reason: 'unverifiable' });
    expect(await checkAdvisory(advisoryDeps({ fetchAdvisory: serve(await s.advisory()), keys: s.keys, store, environment: null }))).toMatchObject({
      ok: false,
      reason: 'unverifiable',
      rejection: 'no-environment',
    });
    expect(store.data.has(ADVISORY_CACHE_KEY)).toBe(false);
  });

  it('a fetched file that does not verify never falls back to a good cache', async () => {
    const s = await signer();
    const store = memoryDeviceSafety({ [ADVISORY_CACHE_KEY]: { file: await s.advisory(), fetchedAt: DAY1.getTime() } });
    expect(await checkAdvisory(advisoryDeps({ fetchAdvisory: serve({ junk: true }), keys: s.keys, store }))).toMatchObject({ ok: false, reason: 'unverifiable' });
  });

  it('offline: the cache is used while younger than 7 days, then LIVE is refused; no cache refuses; a clock moved back refuses', async () => {
    const s = await signer();
    const fetchedAt = DAY1.getTime();
    const store = memoryDeviceSafety({ [ADVISORY_CACHE_KEY]: { file: await s.advisory(), fetchedAt } });
    const at = (ms: number) => advisoryDeps({ fetchAdvisory: offline, keys: s.keys, store, now: () => new Date(ms) });
    expect(await checkAdvisory(at(fetchedAt + ADVISORY_MAX_CACHE_AGE_MS - 1))).toEqual({ ok: true, source: 'cache' });
    expect(await checkAdvisory(at(fetchedAt + ADVISORY_MAX_CACHE_AGE_MS))).toEqual({ ok: false, reason: 'offline-cache-too-old' });
    expect(await checkAdvisory(at(fetchedAt - 1))).toEqual({ ok: false, reason: 'offline-cache-too-old' });
    expect(await checkAdvisory(advisoryDeps({ fetchAdvisory: offline, keys: s.keys }))).toEqual({ ok: false, reason: 'offline-no-cache' });
  });

  it('T-S75: an expired cached advisory fails closed even inside the 7 days; a cached revocation still refuses', async () => {
    const s = await signer();
    const now = new Date('2026-11-30T23:00:00Z');
    const expired = memoryDeviceSafety({ [ADVISORY_CACHE_KEY]: { file: await s.advisory([], '2026-11-30T12:00:00Z'), fetchedAt: now.getTime() - 1000 } });
    expect(await checkAdvisory(advisoryDeps({ fetchAdvisory: offline, keys: s.keys, store: expired, now: () => now }))).toMatchObject({
      ok: false,
      reason: 'unverifiable',
      rejection: 'expired',
    });
    const revoked = memoryDeviceSafety({ [ADVISORY_CACHE_KEY]: { file: await s.advisory([{ sha: SHA, reason: 'r' }]), fetchedAt: DAY1.getTime() } });
    expect(await checkAdvisory(advisoryDeps({ fetchAdvisory: offline, keys: s.keys, store: revoked }))).toMatchObject({ ok: false, reason: 'revoked' });
  });

  it('T-S75: a revocation while LIVE (15-minute poll) denies Arm/Start and jog, never Pause, Stop or Disconnect, and sends the worker nothing', async () => {
    const s = await signer();
    let body: unknown = await s.advisory();
    const intervals: { fn: () => void; ms: number }[] = [];
    const changes: unknown[] = [];
    const poller = new AdvisoryPoller(
      advisoryDeps({ fetchAdvisory: () => Promise.resolve({ ok: true, body }), keys: s.keys }),
      { setInterval: (fn, ms) => intervals.push({ fn, ms }), clearInterval: () => undefined },
      (b) => changes.push(b),
    );
    poller.start();
    expect(intervals.map((i) => i.ms)).toEqual([ADVISORY_POLL_MS]);
    const signedIn: IdentityProvider = { kind: 'access', current: () => Promise.resolve({ provider: 'access', subject: 'o' }) };
    const gates = new LiveGates(new AuthGate([signedIn]), () => poller.blocked);
    await poller.tick();
    expect(await gates.check('armOrStart')).toEqual({ allowed: true });

    body = await s.advisory([{ sha: SHA, reason: 'withdrawn' }]);
    await poller.tick();
    expect(changes).toHaveLength(1);
    expect(await gates.check('armOrStart')).toMatchObject({ allowed: false, reason: 'advisory' });
    expect(await gates.check('jog')).toMatchObject({ allowed: false, reason: 'advisory' });
    for (const a of NEVER_GATED) expect(await gates.check(a), a).toEqual({ allowed: true });
    // A revocation is sticky for the session, even if a later fetch drops it.
    body = await s.advisory();
    await poller.tick();
    expect(await gates.check('jog')).toMatchObject({ allowed: false, reason: 'advisory' });
  });

  it('while LIVE, an advisory that can no longer be verified also blocks new Arm/Start and jog, and clears when it verifies again', async () => {
    const s = await signer();
    let body: unknown = { broken: true };
    const poller = new AdvisoryPoller(advisoryDeps({ fetchAdvisory: () => Promise.resolve({ ok: true, body }), keys: s.keys }), {
      setInterval: () => 1,
      clearInterval: () => undefined,
    });
    await poller.tick();
    expect(poller.blocked).toMatchObject({ reason: 'unverifiable' });
    body = await s.advisory();
    await poller.tick();
    expect(poller.blocked).toBeNull();
  });
});

// ---------------------------------------------------------------- D1 sign-in

const provider = (kind: Identity['provider'], id: () => Identity | null): IdentityProvider => ({ kind, current: () => Promise.resolve(id()) });

describe('D1 sign-in gate (RUN_PLAN §2.2, D41, accepted 2026-11-02)', () => {
  it('G and the never-gated list are disjoint; a non-G action given to check is refused, never passed', async () => {
    expect(IDENTITY_GATED.filter((a) => (NEVER_GATED as readonly string[]).includes(a))).toEqual([]);
    const gate = new AuthGate([provider('bench', () => ({ provider: 'bench', subject: 'x' }))]);
    expect(await gate.check('stopJob' as never)).toEqual({ allowed: false, reason: 'signed-out' });
  });

  it('signed out (no provider says yes): Connect is refused; a provider claiming another kind does not count', async () => {
    expect(await new AuthGate([]).check('connect')).toEqual({ allowed: false, reason: 'signed-out' });
    expect(await new AuthGate([RUN_SESSION_PROVIDER]).check('connect')).toEqual({ allowed: false, reason: 'signed-out' });
    const liar = provider('access', () => ({ provider: 'bench', subject: 'x' }));
    expect(await new AuthGate([liar]).check('connect')).toEqual({ allowed: false, reason: 'signed-out' });
    const thrower: IdentityProvider = { kind: 'access', current: () => Promise.reject(new Error('down')) };
    expect(await new AuthGate([thrower]).check('connect')).toEqual({ allowed: false, reason: 'signed-out' });
  });

  it('providers: production accepts only the run session; staging adds Access; the bench channel only its bench identity', () => {
    const access = provider('access', () => ({ provider: 'access', subject: 'o' }));
    const release = { kind: 'release' as const, benchIdentity: null };
    expect(providersFor(release, 'production', access).map((p) => p.kind)).toEqual(['run-session']);
    expect(providersFor(release, null, access).map((p) => p.kind)).toEqual(['run-session']);
    expect(providersFor(release, 'staging', access).map((p) => p.kind)).toEqual(['run-session', 'access']);
    const bench = { kind: 'bench' as const, current: () => Promise.resolve({ provider: 'bench' as const, subject: 'b' }) };
    expect(providersFor({ kind: 'bench', benchIdentity: bench }, 'staging', access)).toEqual([bench]);
  });

  it('the Access provider accepts only an access identity from the Worker', async () => {
    expect(await accessProvider(() => Promise.resolve({ provider: 'access', subject: 'o' })).current()).toEqual({ provider: 'access', subject: 'o' });
    expect(await accessProvider(() => Promise.resolve({ provider: 'run-session', subject: 'o' })).current()).toBeNull();
    expect(await accessProvider(() => Promise.reject(new Error('x'))).current()).toBeNull();
  });
});

describe('cloud reads', () => {
  it('fetch the advisory and identity with no-store and parse strictly', async () => {
    const seen: [string, RequestInit][] = [];
    const ok = (status: number, body: unknown) => (url: string, init: RequestInit) => {
      seen.push([url, init]);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    };
    expect(await fetchSafetyAdvisory(ok(200, { a: 1 }))).toEqual({ ok: true, body: { a: 1 } });
    expect(await fetchSafetyAdvisory(ok(404, {}))).toEqual({ ok: false });
    expect(await fetchSafetyAdvisory(() => Promise.reject(new Error('offline')))).toEqual({ ok: false });
    expect(await fetchIdentity(ok(200, { identity: { provider: 'access', subject: 'o' } }))).toEqual({ provider: 'access', subject: 'o' });
    expect(await fetchIdentity(ok(401, { identity: null }))).toBeNull();
    expect(await fetchIdentity(ok(200, { identity: { provider: 'bench', subject: 'o' } }))).toBeNull();
    expect(await fetchIdentity(ok(200, { identity: { provider: 'access', subject: '' } }))).toBeNull();
    expect(seen.map(([u, i]) => [u, i.cache])).toEqual([
      ['/safety-advisory.json', 'no-store'],
      ['/safety-advisory.json', 'no-store'],
      ['/api/identity', 'no-store'],
      ['/api/identity', 'no-store'],
      ['/api/identity', 'no-store'],
      ['/api/identity', 'no-store'],
    ]);
  });

  it('fetch a release image from this origin in chunks with progress, capped at the listed size, same-origin, no redirects', async () => {
    const seen: [string, RequestInit][] = [];
    const chunks = (parts: readonly string[], headers: Record<string, string> = {}, status = 200) => (url: string, init: RequestInit) => {
      seen.push([url, init]);
      const enc = new TextEncoder();
      let i = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          if (i < parts.length) c.enqueue(enc.encode(parts[i++] as string));
          else c.close();
        },
      });
      return Promise.resolve(new Response(body, { status, headers }));
    };
    const progress: FirmwareImageProgress[] = [];
    const got = await fetchFirmwareImage('/firmware/synthetos/TinyG/440.21/tinyg-440.21.hex', 16, (p) => progress.push(p), chunks([':0200', '0004', '0000FA\n'], { 'content-length': '16' }));
    expect(got).toEqual({ ok: true, bytes: new TextEncoder().encode(':020000040000FA\n') });
    expect(got.ok && new TextDecoder().decode(got.bytes)).toBe(':020000040000FA\n');
    expect(progress).toEqual([
      { received: 0, total: 16 },
      { received: 5, total: 16 },
      { received: 9, total: 16 },
      { received: 16, total: 16 },
    ]);
    expect(seen[0]?.[0]).toBe('/firmware/synthetos/TinyG/440.21/tinyg-440.21.hex');
    expect(seen[0]?.[1]).toMatchObject({ credentials: 'same-origin', redirect: 'error' });
    // Longer than the listed size: refused while reading, or at once by content-length.
    expect(await fetchFirmwareImage('/firmware/sim/sim-edge-next-450.02.hex', 8, undefined, chunks([':0200', '0004', '0000FA\n']))).toEqual({ ok: false, reason: 'too-large' });
    expect(await fetchFirmwareImage('/firmware/sim/sim-edge-next-450.02.hex', 8, undefined, chunks([':02'], { 'content-length': '9' }))).toEqual({ ok: false, reason: 'too-large' });
    // Not served (404), a network error, and paths that are not a listed image's.
    expect(await fetchFirmwareImage('/firmware/tinyg-440.21.hex', 100, undefined, chunks([], {}, 404))).toEqual({ ok: false, reason: 'not-served' });
    expect(await fetchFirmwareImage('/firmware/tinyg-440.21.hex', 100, undefined, () => Promise.reject(new Error('offline')))).toEqual({ ok: false, reason: 'failed' });
    for (const bad of ['/firmware/../x.hex', '/firmware//x.hex', '/api/x.hex', 'https://evil.example/x.hex', '/firmware/x.bin', '/firmware/.hex']) {
      expect(await fetchFirmwareImage(bad, 100, undefined, chunks(['x'])), bad).toEqual({ ok: false, reason: 'not-served' });
    }
    expect(seen).toHaveLength(4);
  });
});

// ------------------------------------------------------------------------ C1

describe('C1 per LIVE session (SAFETY §6 C1, HIL-1.3 simulated)', () => {
  it('first time full; same day short; next day full; a text change asks for full again; a short acceptance is never stored', async () => {
    const store = memoryDeviceSafety();
    expect(await c1FormFor(store, DAY1)).toBe('full');
    await recordC1(store, 'full', DAY1);
    expect(store.data.has(c1Key(C1_TEXT_VERSION, DAY1))).toBe(true);
    expect(await c1FormFor(store, DAY1_LATE)).toBe('short');
    await recordC1(store, 'short', DAY1_LATE);
    expect(await c1FormFor(store, DAY2)).toBe('full');
    expect(await c1FormFor(store, DAY1, 'other-version')).toBe('full');
    await recordC1(store, 'full', DAY2);
    expect([...store.data.keys()]).toEqual([c1Key(C1_TEXT_VERSION, DAY2)]);
  });

  it('an unreadable store gives the full form', async () => {
    const broken = { ...memoryDeviceSafety(), keys: () => Promise.reject(new Error('blocked')) };
    expect(await c1FormFor(broken, DAY1)).toBe('full');
  });
});

// -------------------------------------------------------------- LIVE entry

interface Harness {
  readonly entry: LiveEntry;
  readonly calls: string[];
  readonly store: ReturnType<typeof memoryDeviceSafety>;
  identity: Identity | null;
}

function harness(over: Partial<LiveEntryDeps> = {}, store = memoryDeviceSafety(), now = () => DAY1): Harness {
  const calls: string[] = [];
  const h: Harness = {
    calls,
    store,
    identity: { provider: 'access', subject: 'owner' },
    entry: undefined as unknown as LiveEntry,
  };
  const auth = new AuthGate([
    {
      kind: 'access',
      current: () => {
        calls.push('auth');
        return Promise.resolve(h.identity);
      },
    },
  ]);
  (h as { entry: LiveEntry }).entry = new LiveEntry({
    auth,
    checkAdvisory: () => {
      calls.push('advisory');
      return Promise.resolve({ ok: true, source: 'fetched' });
    },
    store,
    now,
    choosePort: () => {
      calls.push('choosePort');
      return Promise.resolve({ ok: true, port: PORT });
    },
    open: (port) => {
      calls.push(`open:${port.usbVendorId}`);
      return Promise.resolve({ ok: true });
    },
    leaveFullscreen: () => {
      calls.push('leaveFullscreen');
      return Promise.resolve();
    },
    unlockAlarm: () => calls.push('unlockAlarm'),
    onLive: () => calls.push('onLive'),
    ...over,
  });
  return h;
}

describe('LiveEntry', () => {
  it('signed out: Connect is refused before the advisory, C1 or the chooser', async () => {
    const t = harness();
    t.identity = null;
    await t.entry.begin();
    expect(t.entry.state).toEqual({ step: 'refused', refusal: { kind: 'signed-out' } });
    expect(t.calls).toEqual(['unlockAlarm', 'auth']);
  });

  it('T-S31: an advisory refusal stops entry before C1 and the chooser', async () => {
    const t = harness({ checkAdvisory: () => Promise.resolve({ ok: false, reason: 'offline-no-cache' }) });
    await t.entry.begin();
    expect(t.entry.state).toMatchObject({ step: 'refused', refusal: { kind: 'advisory', check: { reason: 'offline-no-cache' } } });
    expect(t.calls).not.toContain('choosePort');
  });

  it('unlocks the alarm synchronously inside the Connect click, before any await (T-S30)', () => {
    const t = harness();
    void t.entry.begin();
    // Before the identity read, and before begin() first yields.
    expect(t.calls[0]).toBe('unlockAlarm');
  });

  it('C1 must have every box ticked; the chooser is never shown otherwise', async () => {
    const t = harness();
    await t.entry.begin();
    expect(t.entry.state).toEqual({ step: 'c1', form: 'full', boxes: c1Full().boxes.length });
    await t.entry.confirm([true, true, true, true, false]);
    expect(t.entry.state).toEqual({ step: 'refused', refusal: { kind: 'c1-incomplete' } });
    expect(t.calls).not.toContain('choosePort');
    expect(await c1FormFor(t.store, DAY1)).toBe('full');
  });

  it('happy path: chooser called synchronously in the confirm click, fullscreen left, port opened, marker written, poll started', async () => {
    const t = harness();
    await t.entry.begin();
    const done = t.entry.confirm([true, true, true, true, true]);
    // Synchronously, so requestPort() still has this click's user activation.
    expect(t.calls.slice(-2)).toEqual(['choosePort', 'leaveFullscreen']);
    await done;
    expect(t.entry.state).toEqual({ step: 'live' });
    expect(t.calls).toEqual(['unlockAlarm', 'auth', 'advisory', 'choosePort', 'leaveFullscreen', `open:${PORT.usbVendorId}`, 'onLive']);
    expect(t.store.data.get(LIVE_MARKER_KEY)).toEqual({ since: DAY1.toISOString() });
  });

  it('E2E-equivalent: a same-day reconnect shows the short form, the next day the full form; C1 is asked for every session', async () => {
    const store = memoryDeviceSafety();
    let now = DAY1;
    const t = harness({}, store, () => now);
    await t.entry.begin();
    await t.entry.confirm([true, true, true, true, true]);
    t.entry.reset();
    now = DAY1_LATE;
    await t.entry.begin();
    expect(t.entry.state).toEqual({ step: 'c1', form: 'short', boxes: c1Short().boxes.length });
    await t.entry.confirm([true]);
    t.entry.reset();
    now = DAY2;
    await t.entry.begin();
    expect(t.entry.state).toMatchObject({ step: 'c1', form: 'full' });
  });

  it('a cancelled chooser or a failed open is a refusal, and no marker is written', async () => {
    const t = harness({ choosePort: () => Promise.resolve({ ok: false, message: 'No port chosen.' }) });
    await t.entry.begin();
    await t.entry.confirm([true, true, true, true, true]);
    expect(t.entry.state).toEqual({ step: 'refused', refusal: { kind: 'no-port', message: 'No port chosen.' } });
    expect(t.store.data.has(LIVE_MARKER_KEY)).toBe(false);
    const u = harness({ open: () => Promise.resolve({ ok: false, message: 'busy' }) });
    await u.entry.begin();
    await u.entry.confirm([true, true, true, true, true]);
    expect(u.entry.state).toMatchObject({ step: 'refused', refusal: { kind: 'open-failed' } });
    expect(u.calls).not.toContain('onLive');
  });

  it("the chooser's connect/disconnect guard is released on every exit from open: opened, refused, or thrown", async () => {
    for (const outcome of ['ok', 'refused', 'throws'] as const) {
      const order: string[] = [];
      const t = harness({
        choosePort: () => Promise.resolve({ ok: true, port: PORT, confirm: async () => true, release: () => order.push('release') }),
        open: async () => {
          order.push('open');
          if (outcome === 'throws') throw new Error('worker gone');
          return outcome === 'ok' ? { ok: true } : { ok: false, message: 'The granted ports changed. Choose the port again.' };
        },
      });
      await t.entry.begin();
      await t.entry.confirm([true, true, true, true, true]).catch(() => undefined);
      expect(order, outcome).toEqual(['open', 'release']);
      if (outcome === 'refused') expect(t.entry.state).toMatchObject({ step: 'refused', refusal: { kind: 'open-failed' } });
    }
  });

  it('mid-session loss of the identity changes nothing in the machine path: no worker call, stops still allowed, only new G requests refused', async () => {
    const t = harness();
    await t.entry.begin();
    await t.entry.confirm([true, true, true, true, true]);
    const gates = new LiveGates(new AuthGate([provider('access', () => t.identity)]), () => null);
    t.identity = null;
    const before = [...t.calls];
    for (const a of NEVER_GATED) expect(await gates.check(a), a).toEqual({ allowed: true });
    expect(await gates.check('armOrStart')).toEqual({ allowed: false, reason: 'signed-out' });
    expect(await gates.check('jog')).toEqual({ allowed: false, reason: 'signed-out' });
    expect(t.entry.state).toEqual({ step: 'live' });
    expect(t.calls).toEqual(before);
    expect(t.calls.filter((c) => c.startsWith('open:'))).toHaveLength(1);
  });
});

// ------------------------------------------------------------------- W6

describe('W6 and the liveSession marker (T-S17)', () => {
  it('a marker or a discarded page shows W6; a clean Disconnect removes the marker; an unreadable store shows W6', async () => {
    const store = memoryDeviceSafety();
    expect(await previousSessionEnded(store, false)).toBe(false);
    expect(await previousSessionEnded(store, true)).toBe(true);
    await markLive(store, DAY1);
    expect(await previousSessionEnded(store, false)).toBe(true);
    await clearLive(store);
    expect(await previousSessionEnded(store, false)).toBe(false);
    expect(await previousSessionEnded({ ...store, get: () => Promise.reject(new Error('x')) }, false)).toBe(true);
  });

  it('only a close the worker confirmed is a clean Disconnect: a refused or failed close keeps the marker and LIVE', async () => {
    const store = memoryDeviceSafety();
    await markLive(store, DAY1);
    let cleaned = 0;
    const onClean = () => void cleaned++;
    expect(await cleanDisconnect(() => Promise.resolve({ ok: false }), store, onClean)).toBe(false);
    expect(await cleanDisconnect(() => Promise.reject(new Error('worker gone')), store, onClean)).toBe(false);
    expect(store.data.has(LIVE_MARKER_KEY)).toBe(true);
    expect(cleaned).toBe(0);
    expect(await cleanDisconnect(() => Promise.resolve({ ok: true }), store, onClean)).toBe(true);
    expect(store.data.has(LIVE_MARKER_KEY)).toBe(false);
    expect(cleaned).toBe(1);
  });

  it('pagehide and freeze record the marker only while LIVE; beforeunload prompts only while LIVE', async () => {
    const listeners: Record<string, (e: Event) => void> = {};
    const target = { addEventListener: (t: string, l: (e: Event) => void) => (listeners[t] = l) };
    const store = memoryDeviceSafety();
    let live = false;
    installLiveLifecycle(target, target, store, () => live, () => DAY1);
    const unload = () => {
      let prevented = false;
      listeners['beforeunload']?.({ preventDefault: () => (prevented = true) } as unknown as Event);
      return prevented;
    };
    listeners['pagehide']?.(new Event('pagehide'));
    await Promise.resolve();
    expect(store.data.has(LIVE_MARKER_KEY)).toBe(false);
    expect(unload()).toBe(false);
    live = true;
    listeners['freeze']?.(new Event('freeze'));
    await new Promise((r) => setTimeout(r, 0));
    expect(store.data.has(LIVE_MARKER_KEY)).toBe(true);
    expect(unload()).toBe(true);
  });

  it('T-S17: the previous-session banner overrides NOT CONNECTED in the machine strip', () => {
    const status = stripStatus(INITIAL_LIVE_VIEW, null);
    const bar = root(h(MachineStrip, { status, stop: null, previousSession: true }));
    expect(all(bar, byAttr('data-safety', 'W7'))).toHaveLength(0);
    const band = all(bar, byAttr('data-safety', 'W6'));
    expect(band).toHaveLength(1);
    expect(text(band[0] as never)).toContain(w6().slice(-60));
    const again = root(h(MachineStrip, { status, stop: null, previousSession: false }));
    expect(all(again, byAttr('data-safety', 'W6'))).toHaveLength(0);
    expect(text(all(again, byAttr('data-safety', 'W7'))[0] as never)).toContain(w7().slice(0, 13));
  });
});

// --------------------------------------------------------- panel, fullscreen

describe('ConnectPanel and fullscreen', () => {
  const noop = () => undefined;
  const props = { advisoryBlocked: null, onConnect: noop, onConfirm: noop, onCancel: noop, onDisconnect: noop };

  it('renders C1 full (5 boxes) and short (1 box) from the safety strings', () => {
    const full = root(h(ConnectPanel, { ...props, state: { step: 'c1', form: 'full', boxes: 5 } }));
    expect(full.props['data-c1-form']).toBe('full');
    expect(all(full, (e) => e.tag === 'input')).toHaveLength(5);
    expect(text(full)).toContain(c1Full().boxes[0] as string);
    const short = root(h(ConnectPanel, { ...props, state: { step: 'c1', form: 'short', boxes: 1 } }));
    expect(all(short, (e) => e.tag === 'input')).toHaveLength(1);
    expect(text(short)).toContain(c1Short().boxes[0] as string);
  });

  it('signed out shows the sign-in refusal; LIVE with a revocation shows the advisory banner and Disconnect stays', () => {
    const refused = root(h(ConnectPanel, { ...props, state: { step: 'refused', refusal: { kind: 'signed-out' } } }));
    expect(text(refused)).toContain(refusalText({ kind: 'signed-out' }));
    const live = root(
      h(ConnectPanel, { ...props, state: { step: 'live' }, advisoryBlocked: { ok: false, reason: 'revoked', revocation: { sha: SHA, reason: 'bug' } } }),
    );
    expect(all(live, byAttr('data-advisory', 'revoked'))).toHaveLength(1);
    expect(all(live, byAttr('data-action', 'disconnect'))).toHaveLength(1);
  });

  it('leaves fullscreen when in it, does nothing otherwise, and never throws', async () => {
    let exited = 0;
    const doc = (el: Element | null, fail = false) => ({
      fullscreenElement: el,
      exitFullscreen: () => {
        exited++;
        return fail ? Promise.reject(new Error('no')) : Promise.resolve();
      },
    });
    expect(await leaveFullscreen(doc(null))).toBe(false);
    expect(exited).toBe(0);
    expect(await leaveFullscreen(doc({} as Element))).toBe(true);
    expect(await leaveFullscreen(doc({} as Element, true))).toBe(false);
    expect(exited).toBe(2);
  });
});
