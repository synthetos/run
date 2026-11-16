import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import type { Database, Statement } from '../src/database.ts';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

/** Every migration file in order, as D1 applies them. */
export function migrations(): readonly string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
}

export function migrationSql(name: string): string {
  return readFileSync(new URL(name, MIGRATIONS), 'utf8');
}

/** A real SQLite database behind the Worker's D1 interface, with the migrations applied through `through` (default: all). */
export function database(through: string = migrations().at(-1)!) {
  const sql = new DatabaseSync(':memory:');
  for (const name of migrations()) { if (name <= through) sql.exec(migrationSql(name)); }
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
