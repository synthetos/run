/**
 * Deploy preflight (ROADMAP P0-04, D39, SAFETY H45, H46). The deploy jobs run
 * it immediately before `wrangler deploy`:
 *
 *   node tools/gates/src/deploy/preflight.ts workers/run/wrangler.jsonc <production|staging> \
 *     --write workers/run/wrangler.deploy.json
 *
 * On acceptance it writes the deployment configuration (deployConfig: the
 * allowlisted keys of the checked file, nothing else) to the --write path,
 * which must not exist yet. The deploy and undo steps give wrangler only
 * that file (ci-policy `deploy-config`), because wrangler runs a configured
 * custom build even under --no-bundle, with the deploy token (P0-04 review).
 *
 * It refuses to let a deploy proceed when:
 * - a dotenv file (.env, .env.<anything>) exists in the working directory,
 *   which wrangler would load into its environment (P0-04 review);
 * - the configuration fails checkWorkerConfig (workers_dev or preview_urls
 *   not false, wrong routes, wrong assets settings, ...);
 * - account_id is still the placeholder or not a Cloudflare account id;
 * - account_id differs from the CLOUDFLARE_ACCOUNT_ID the job was given (the
 *   repository variable the owner sets): the reviewed file and the
 *   environment must name the same account (the current one, D39).
 *
 * Exit status: 0 go, 1 refused, 2 could not run.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { checkWorkerConfig, deployConfig, isDeployEnvironment, parseJsonc } from './wranglerConfig.ts';

function main(argv: readonly string[]): number {
  const [file, env, flag, out] = argv;
  if (file === undefined || env === undefined || argv.length !== 4 || flag !== '--write' || out === undefined || out === '' || !isDeployEnvironment(env)) {
    process.stderr.write('usage: deploy/preflight.ts <wrangler.jsonc> <production|staging> --write <deployment-config.json>\n');
    return 2;
  }
  try {
    const config = parseJsonc(readFileSync(file, 'utf8'));
    const findings = checkWorkerConfig(config, { requireRealAccount: true });
    const fromEnv = process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '';
    const fromFile = (config as { account_id?: unknown }).account_id;
    if (fromEnv === '') findings.push({ where: 'CLOUDFLARE_ACCOUNT_ID', message: 'is not set for this job' });
    else if (fromEnv !== fromFile) findings.push({ where: 'CLOUDFLARE_ACCOUNT_ID', message: 'differs from account_id in the reviewed wrangler.jsonc' });
    // wrangler loads .env, .env.local, .env.<env> and .env.<env>.local from its working directory into
    // its process environment whatever --config says (CLOUDFLARE_API_BASE_URL there would send the
    // deploy token elsewhere). The wrangler steps run in this directory: no dotenv file may exist here.
    for (const entry of readdirSync(process.cwd())) {
      if (/^\.env(\.|$)/i.test(entry)) findings.push({ where: entry, message: 'a dotenv file in the deploy working directory is never allowed: wrangler loads it into its environment, with the deploy token' });
    }
    if (findings.length > 0) {
      process.stderr.write(`deploy preflight (${env}): refused, nothing was deployed\n`);
      for (const f of findings) process.stderr.write(`  ${f.where}: ${f.message}\n`);
      return 1;
    }
    // 'wx': never overwrite. A deployment configuration already in the checkout was not written by this check.
    writeFileSync(out, `${JSON.stringify(deployConfig(config, { requireRealAccount: true }), null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`deploy preflight (${env}): configuration accepted; deployment configuration written to ${out}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`deploy preflight: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
