/**
 * A signed-in account for the browser tests, with an in-memory record and file service behind the page's own
 * routes: `/api/session` and `/api/identity` say who is signed in; `/api/records/<kind>` lists and stores records
 * with the Worker's CAS shape (`rev` from `parent_rev`); `/api/files` accepts uploads and hands them back. Nothing
 * leaves the origin (fixtures.ts guards that). Used by the setup wizard spec; other specs stub the same routes inline.
 */
import type { Page } from '@playwright/test';
import type { CloudRecord } from '../../../packages/contracts/src/records.ts';

export interface FakeAccount {
  readonly records: Map<string, CloudRecord>;
  readonly files: Map<string, Buffer>;
  /** Records of one kind, newest content, in id order. */
  ofKind(kind: string): CloudRecord[];
}

const key = (kind: string, id: string): string => `${kind}:${id}`;

export async function stubAccount(page: Page, options: { readonly canConnect?: boolean; readonly subject?: string } = {}): Promise<void> {
  const subject = options.subject ?? 'usr_alice';
  await page.route('**/api/session', (route) => route.fulfill({ json: { account: { subject, display: '@alice', canConnect: options.canConnect ?? true }, signIn: true } }));
  await page.route('**/api/identity', (route) => route.fulfill({ json: { identity: { provider: 'run-session', subject, canConnect: options.canConnect ?? true } } }));
}

export async function fakeRecords(page: Page, seed: readonly CloudRecord[] = []): Promise<FakeAccount> {
  const records = new Map<string, CloudRecord>(seed.map((r) => [key(r.kind, r.id), r]));
  const files = new Map<string, Buffer>();
  const ofKind = (kind: string): CloudRecord[] => [...records.values()].filter((r) => r.kind === kind).sort((a, b) => a.id.localeCompare(b.id));
  await page.route('**/api/records/**', async (route) => {
    const url = new URL(route.request().url());
    const [, , , kind, id] = url.pathname.split('/');
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ json: { records: ofKind(kind ?? '') } });
    const body = route.request().postDataJSON() as { parent_rev: number | null; content?: unknown };
    const current = records.get(key(kind ?? '', id ?? ''));
    if ((current?.rev ?? null) !== body.parent_rev) return route.fulfill({ status: 409, json: { error: 'conflict', current: current ?? null } });
    const rev = (body.parent_rev ?? 0) + 1;
    const record: CloudRecord = method === 'PUT'
      ? { id: id ?? '', kind: kind as CloudRecord['kind'], rev, archivedAt: null, content: body.content, sha256: 'a'.repeat(64) }
      : { ...(current as CloudRecord), rev, archivedAt: Date.now() };
    records.set(key(kind ?? '', id ?? ''), record);
    return route.fulfill({ json: { record } });
  });
  await page.route('**/api/files**', async (route) => {
    const url = new URL(route.request().url());
    const hash = url.pathname.split('/')[3];
    const method = route.request().method();
    if (method === 'GET' && hash === undefined) return route.fulfill({ json: { files: [...files.entries()].map(([sha256, buffer]) => ({ sha256, size: buffer.length, createdAt: 1 })) } });
    if (method === 'GET') { const found = files.get(hash ?? ''); return found === undefined ? route.fulfill({ status: 404, json: { error: 'not_found' } }) : route.fulfill({ status: 200, contentType: 'application/octet-stream', body: found }); }
    if (method === 'PUT') { files.set(hash ?? '', route.request().postDataBuffer() ?? Buffer.alloc(0)); return route.fulfill({ status: 201, json: {} }); }
    files.delete(hash ?? '');
    return route.fulfill({ status: 204, body: '' });
  });
  return { records, files, ofKind };
}

/** A setup record as the account would hold it. */
export function setupRecord(content: Record<string, unknown>, rev = 1): CloudRecord {
  const base = { v: 1, id: 'setup', dismissed: false, step: 1, done: [], homing: null, stock: null, toolId: null, machineId: null, projectId: null, updatedAt: '2026-11-18T00:00:00.000Z' };
  return { id: 'setup', kind: 'setup', rev, archivedAt: null, content: { ...base, ...content }, sha256: 'a'.repeat(64) };
}
