import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { Database, Statement } from '../src/database.ts';
export function database() {
  const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../migrations/0001_records.sql', import.meta.url),'utf8'));
  let tail = Promise.resolve();
  const db: Database = {
    prepare(query) {
      let args: unknown[] = []; const statement = sql.prepare(query);
      const self: Statement = {
        bind(...values) { args = values; return self; },
        async first<T>() { return (statement.get(...args as never[]) as T | undefined) ?? null; },
        async all<T>() { return { results: statement.all(...args as never[]) as T[] }; },
        async run() { return { meta: { changes: Number(statement.run(...args as never[]).changes) } }; },
      }; return self;
    },
    batch(statements) { const work = tail.then(async () => { sql.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); sql.exec('COMMIT'); return out; } catch (e) { sql.exec('ROLLBACK'); throw e; } }); tail = work.then(() => undefined, () => undefined); return work; },
  }; return { db, sql };
}
