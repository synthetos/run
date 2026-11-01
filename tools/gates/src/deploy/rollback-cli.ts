/**
 * Undo a deployment whose post-deploy smoke test failed (P0 review; see
 * rollback.ts).
 *
 *   node tools/gates/src/deploy/rollback-cli.ts <production|staging> <wrangler-binary>
 *
 * Runs the plan's wrangler commands in order until one succeeds. Exit
 * status: 0 the deployment was undone, 1 every command failed (the job log
 * then says the deployment is STILL LIVE), 2 could not run.
 */
import { spawnSync } from 'node:child_process';
import { rollbackPlan } from './rollback.ts';
import { isDeployEnvironment } from './wranglerConfig.ts';

function main(argv: readonly string[]): number {
  const [env, wrangler] = argv;
  if (argv.length !== 2 || env === undefined || wrangler === undefined || !isDeployEnvironment(env)) {
    process.stderr.write('usage: rollback-cli.ts <production|staging> <wrangler-binary>\n');
    return 2;
  }
  for (const args of rollbackPlan(env)) {
    process.stdout.write(`rollback (${env}): wrangler ${args.join(' ')}\n`);
    const r = spawnSync(wrangler, [...args], { stdio: 'inherit' });
    if (r.status === 0) {
      process.stdout.write(`rollback (${env}): done\n`);
      return 0;
    }
  }
  process.stderr.write(`::error::rollback (${env}) failed: the deployment that failed its smoke test is STILL LIVE; act now\n`);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
