import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { provisionDatabase } from '../src/deploy/authProvision.ts';
import { checkWorkflow } from '../src/workflow/policy.ts';
import { AUTH_PROVISION_WORKFLOW } from '../src/workflow/authProvisionWorkflow.ts';
import { REPO_ROOT } from './scratch.ts';
const account = 'a'.repeat(32), id = '11111111-2222-4333-8444-555555555555';
it('reuses the named run-auth on later pages or creates only run-auth', async () => {
  for (const exists of [true, false]) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input); calls.push({ url, ...(init === undefined ? {} : { init }) });
      expect(init?.headers).toMatchObject({ authorization: 'Bearer secret' }); expect(init?.redirect).toBe('error');
      return Response.json({ success: true, result: init?.method === 'POST' ? { uuid: id } : exists && url.endsWith('page=2') ? [{ name: 'run-auth', uuid: id }] : [], result_info: { total_pages: 2 } });
    };
    expect(await provisionDatabase(account, 'secret', fetcher)).toBe(id);
    expect(calls).toHaveLength(exists ? 2 : 3);
    if (!exists) expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ name: 'run-auth' });
  }
});
it('refuses invalid credentials, denial, malformed responses and duplicate names', async () => {
  await expect(provisionDatabase('bad', 't')).rejects.toThrow('ACCOUNT_ID');
  await expect(provisionDatabase(account, '')).rejects.toThrow('D1: Edit');
  for (const status of [401, 403, 500]) await expect(provisionDatabase(account, 't', async () => new Response('secret', { status }))).rejects.toThrow('D1');
  for (const body of [{ success: false }, { success: true, result: {} }, { success: true, result: [], result_info: { total_pages: -1 } }, { success: true, result: [{ name: 'run-auth', uuid: 'bad' }] }, { success: true, result: [{ name: 'run-auth', uuid: id }, { name: 'run-auth', uuid: id }] }]) await expect(provisionDatabase(account, 't', async () => Response.json(body))).rejects.toThrow();
});
it('permits only the exact reviewed main-only, production-protected provisioning workflow', () => {
  const source = readFileSync(join(REPO_ROOT, '.github/workflows/production-provision.yml'), 'utf8');
  expect(source).toBe(AUTH_PROVISION_WORKFLOW);
  expect(checkWorkflow('production-provision.yml', source)).toEqual([]);
  for (const [before, after] of [['environment: production', 'environment: staging'], ["github.ref == 'refs/heads/main'", 'true'], ['workflow_dispatch:', 'push:'], ['CLOUDFLARE_D1_API_TOKEN', 'CLOUDFLARE_API_TOKEN'], ['persist-credentials: false', 'persist-credentials: true'], ['node tools/gates/src/deploy/auth-provision-cli.ts', 'echo secret']]) expect(checkWorkflow('production-provision.yml', source.replace(before!, after!))).not.toEqual([]);
  expect(checkWorkflow('other.yml', source)).not.toEqual([]);
});
