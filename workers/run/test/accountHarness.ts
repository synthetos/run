import type { RecordActor, RunDataBinding, RunFilesBinding } from '@synthetos/contracts';
import { authEnv } from './authHarness.ts';

const notFound = { ok: false, error: 'not_found' } as const;

/** A run environment with a validated session for usr_alice and a replaceable fake data Worker; every call records its actor. */
export function accountEnv(environment: 'staging' | 'production') {
  const { env } = authEnv(environment, () => Math.floor(Date.now() / 1000));
  const actors: RecordActor[] = [];
  env.ACCOUNTS!.validateSession = async () => ({ id: 'session', sub: 'usr_alice', name: 'alice', client: 'run', identities: [{ provider: 'github', id: '1', login: 'alice' }], absoluteExpiresAt: Math.floor(Date.now() / 1000) + 600, deviceRecordId: null, sharedComputer: false });
  const seen = <T>(actor: RecordActor, value: T): T => { actors.push(actor); return value; };
  const data: RunDataBinding & RunFilesBinding = {
    list: async (actor) => seen(actor, []),
    get: async (actor) => seen(actor, notFound),
    put: async (actor) => seen(actor, { ok: false, error: 'conflict', current: null }),
    archive: async (actor) => seen(actor, notFound),
    putFile: async (actor) => seen(actor, { ok: false, error: 'failed' }),
    getFile: async (actor) => seen(actor, notFound),
    listFiles: async (actor) => seen(actor, []),
    deleteFile: async (actor) => seen(actor, notFound),
  };
  return { env: { ...env, RUN_DATA: data }, data, actors, origin: environment === 'production' ? 'https://run.synthetos.com' : 'https://staging.run.synthetos.com' };
}

export const SESSION_COOKIE = `__Host-run_sid=${Buffer.alloc(32, 1).toString('base64url')}`;
