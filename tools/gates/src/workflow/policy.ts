/**
 * Workflow policy check (ROADMAP P0-03, RUN_PLAN §6.2).
 *
 * Reads `.github/workflows/*.yml` as text and enforces the CI discipline that
 * keeps the deploy token away from everything but the deploy jobs:
 *
 * - `secret-outside-deploy`: no job other than `deploy-staging` and
 *   `deploy-production` mentions `secrets` (or the Cloudflare token by name),
 *   and nothing outside a job does. The deploy jobs may use only
 *   `secrets.CLOUDFLARE_API_TOKEN`. `secrets: inherit`, `secrets[...]` and
 *   `toJSON(secrets)` are refused everywhere.
 * - `deploy-gate`: each deploy job runs only on a push to `main` (its `if:`
 *   is a plain conjunction of equalities that requires both), needs `verify`, `build`, `e2e`,
 *   `e2e-fake-serial` and `attest`, and declares its protected environment.
 * - `environment-outside-deploy`: no other job names an environment (an
 *   environment can carry secrets).
 * - `unpinned-action`: every `uses:` is pinned to a full commit SHA (or is a
 *   local `./` action).
 * - `banned-trigger`: no `pull_request_target` or `workflow_run`, which run
 *   with secrets on untrusted code.
 * - `expression-in-run`: no `${{ ... }}` inside a `run:` script. Values reach
 *   scripts through `env:` only, so a PR title or branch name can never
 *   become shell code.
 * - `write-permission`: no `write-all`; `write` scopes only where listed in
 *   WRITE_PERMISSIONS; top-level permissions are read-only.
 * - `continue-on-error`: refused, so a failing gate always fails the run.
 * - `verify-job` (ci.yml): a `verify` job with no `if:` runs the tests on
 *   every pull request.
 * - `e2e-job` (ci.yml, P0-06): the `e2e` job is unconditional, needs
 *   `build`, points RUN_E2E_SITE and RUN_E2E_WORKER at the extracted
 *   artifact for every step (and nothing else in the job names them),
 *   verifies both trees against their manifests,
 *   then runs the suite, then the third-party canary, in that order.
 * - `fake-serial-job` (ci.yml, P0-14): the `e2e-fake-serial` job is
 *   unconditional, needs `build`, builds the fake-serial test artifact before
 *   it downloads anything, verifies the production site, runs the artifact
 *   diff against it and then the fake-serial suite, in that order. It never
 *   uploads anything (the test build must never become an artifact) and
 *   never names RUN_E2E_SITE or RUN_E2E_WORKER.
 * - `artifact-digest` (ci.yml, P0 review): the `build` job publishes the
 *   sha256 of the four artifact files as job outputs (only it can set
 *   them), and every job that downloads the artifact (`ARTIFACT_CONSUMERS`)
 *   checks the downloaded files against those outputs right after the
 *   download and before it attests, extracts or deploys anything. This
 *   closes artifact poisoning: another job of the same run replacing
 *   `run-web` under the same name.
 * - `deploy-rollback` (ci.yml, P0 review): each deploy job's deploy step has
 *   `id: deploy`, and after the smoke test a step runs
 *   `rollback-cli.ts <env>` under exactly
 *   `if: failure() && steps.deploy.outcome == 'success'`, so a deployment
 *   whose smoke test failed never stays live.
 * - `deploy-config` (ci.yml, P0-04 review): each deploy job's preflight
 *   writes the allowlisted deployment configuration (DEPLOY_CONFIG), and
 *   every wrangler invocation comes after it and uses only that file; no
 *   other line writes it or reads wrangler.jsonc. wrangler runs a configured
 *   build.command even under --no-bundle, with the deploy token.
 * - `smoke-credentials` (ci.yml, P0 review): every smoke-test step of a
 *   deploy job, the staging pre-deploy Access check included, sets the
 *   Cloudflare token and account in its own env.
 * - `safety-review-job` (safety-review.yml): the gate runs from the base
 *   commit with the reviewers' repository permissions. A consistency check
 *   only: the primary control is native branch protection.
 * - `yaml-subset`: tabs, anchors, aliases and merge keys are refused. They
 *   are valid YAML that this line-based reader could not follow, so they are
 *   not allowed to hide anything from it.
 *
 * The reader is deliberately simple: it understands the block-style YAML
 * these files use and fails closed on anything else. Dependency-free.
 */

export const DEPLOY_JOBS: readonly string[] = ['deploy-staging', 'deploy-production'];
export const DEPLOY_ENVIRONMENTS: Readonly<Record<string, string>> = {
  'deploy-staging': 'staging',
  'deploy-production': 'production',
};
export const DEPLOY_NEEDS: readonly string[] = ['verify', 'build', 'e2e', 'e2e-fake-serial', 'attest'];
export const DEPLOY_SECRET = 'CLOUDFLARE_API_TOKEN';

/** The e2e job's job-level env: the extracted artifact (tools/e2e/src/served.ts). */
export const E2E_ENV: Readonly<Record<string, string>> = {
  RUN_E2E_SITE: '${{ github.workspace }}/site',
  RUN_E2E_WORKER: '${{ github.workspace }}/worker',
};

/** The e2e job's steps that must appear, in this order (each a whole line of the job). */
export const E2E_STEPS: readonly string[] = [
  'node tools/gates/src/repro/cli.ts verify site artifact/run-web.sha256',
  'node tools/gates/src/repro/cli.ts verify worker artifact/run-worker.sha256',
  'run: pnpm --filter @synthetos/e2e e2e',
  'run: pnpm --filter @synthetos/e2e canary',
];

/** The e2e-fake-serial job's steps that must appear, in this order (each a whole line of the job). */
export const FAKE_SERIAL_STEPS: readonly string[] = [
  'run: pnpm build:fake-serial',
  'node tools/gates/src/repro/cli.ts verify site artifact/run-web.sha256',
  'run: node tools/gates/src/artifact/diff-cli.ts site apps/web/dist-fake-serial',
  'run: pnpm --filter @synthetos/e2e e2e:fake-serial',
];

/** The build job's outputs: one sha256 per artifact file, each set by its `digests` step. */
export const ARTIFACT_DIGESTS: Readonly<Record<string, string>> = {
  'run-web-tar': 'artifact/run-web.tar',
  'run-web-manifest': 'artifact/run-web.sha256',
  'run-worker-tar': 'artifact/run-worker.tar',
  'run-worker-manifest': 'artifact/run-worker.sha256',
};

/** The env a consumer's check step takes the digests from (key: env name, value: build output). */
export const DIGEST_ENV: Readonly<Record<string, string>> = {
  RUN_WEB_TAR_SHA256: 'run-web-tar',
  RUN_WEB_MANIFEST_SHA256: 'run-web-manifest',
  RUN_WORKER_TAR_SHA256: 'run-worker-tar',
  RUN_WORKER_MANIFEST_SHA256: 'run-worker-manifest',
};

/** The line that checks the downloaded files. */
export const DIGEST_CHECK = 'sha256sum --check --strict artifact-digests.txt';

/** Jobs that download the artifact, and the first line after which the check would be too late. */
export const ARTIFACT_CONSUMERS: Readonly<Record<string, RegExp>> = {
  e2e: /tar -xf artifact\//,
  'e2e-fake-serial': /tar -xf artifact\//,
  attest: /uses:\s*actions\/attest-build-provenance@/,
  'deploy-staging': /gh attestation verify|tar -xf artifact\//,
  'deploy-production': /gh attestation verify|tar -xf artifact\//,
};

/** The only `write` permission scopes any job may hold, by workflow file and job. */
export const WRITE_PERMISSIONS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  'ci.yml': { attest: ['id-token', 'attestations'] },
};

export type PolicyRule =
  | 'secret-outside-deploy'
  | 'deploy-gate'
  | 'environment-outside-deploy'
  | 'unpinned-action'
  | 'banned-trigger'
  | 'expression-in-run'
  | 'write-permission'
  | 'continue-on-error'
  | 'verify-job'
  | 'e2e-job'
  | 'fake-serial-job'
  | 'artifact-digest'
  | 'deploy-rollback'
  | 'deploy-config'
  | 'smoke-credentials'
  | 'safety-review-job'
  | 'yaml-subset';

export interface PolicyFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: PolicyRule;
  readonly message: string;
}

interface Line {
  readonly no: number;
  readonly indent: number;
  /** The line without its indentation or a trailing comment (outside block scalars). */
  readonly text: string;
  /** True for the content lines of a `|` or `>` block scalar. */
  readonly inBlock: boolean;
  /** For block content: the key that opened the block (`run`, ...). */
  readonly blockKey: string | undefined;
}

export interface Job {
  readonly name: string;
  readonly line: number;
  readonly lines: readonly Line[];
}

function stripComment(text: string): string {
  // A `#` starts a comment when it begins the text or follows whitespace and
  // is not inside quotes. The workflows keep quoting simple, so a scan for
  // quote state is enough.
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(text[i - 1] ?? ''))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

export function readLines(source: string): Line[] {
  const out: Line[] = [];
  let block: { indent: number; key: string } | undefined;
  source.split('\n').forEach((raw, index) => {
    const no = index + 1;
    const indent = raw.length - raw.trimStart().length;
    if (block !== undefined) {
      if (raw.trim() === '' || indent > block.indent) {
        out.push({ no, indent, text: raw.trim(), inBlock: true, blockKey: block.key });
        return;
      }
      block = undefined;
    }
    const text = stripComment(raw.trim());
    out.push({ no, indent, text, inBlock: false, blockKey: undefined });
    const opener = /^(?:-\s+)?([A-Za-z0-9_-]+):\s*[|>][-+]?\d*$/.exec(text);
    if (opener?.[1] !== undefined) block = { indent: text.startsWith('-') ? indent + 2 : indent, key: opener[1] };
  });
  return out;
}

/** The jobs of a workflow: keys at indent 2 under the top-level `jobs:`. */
export function readJobs(lines: readonly Line[]): Job[] {
  const start = lines.findIndex((l) => !l.inBlock && l.indent === 0 && l.text === 'jobs:');
  if (start === -1) return [];
  const jobs: { name: string; line: number; lines: Line[] }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.inBlock && line.indent === 0 && line.text !== '') break;
    const key = !line.inBlock && line.indent === 2 ? /^([A-Za-z_][A-Za-z0-9_-]*):$/.exec(line.text) : null;
    if (key?.[1] !== undefined) jobs.push({ name: key[1], line: line.no, lines: [] });
    else jobs.at(-1)?.lines.push(line);
  }
  return jobs;
}

/** The value of `key:` at the job's top level (indent 4), single-line form only. */
function jobScalar(job: Job, key: string): { value: string; line: number } | undefined {
  for (const line of job.lines) {
    if (line.inBlock || line.indent !== 4) continue;
    const m = new RegExp(`^${key}:\\s*(.*)$`).exec(line.text);
    if (m) return { value: (m[1] ?? '').trim(), line: line.no };
  }
  return undefined;
}

/** The nested block under a job-level `key:` (lines indented deeper than 4). */
function jobBlock(job: Job, key: string): Line[] {
  const index = job.lines.findIndex((l) => !l.inBlock && l.indent === 4 && new RegExp(`^${key}:`).test(l.text));
  if (index === -1) return [];
  const out: Line[] = [];
  for (const line of job.lines.slice(index + 1)) {
    if (!line.inBlock && line.text !== '' && line.indent <= 4) break;
    out.push(line);
  }
  return out;
}

function listValue(job: Job, key: string): string[] {
  const scalar = jobScalar(job, key);
  if (scalar === undefined) return [];
  const flow = /^\[(.*)\]$/.exec(scalar.value);
  if (flow) return (flow[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (scalar.value !== '') return [scalar.value];
  return jobBlock(job, key)
    .map((l) => /^-\s+(.+)$/.exec(l.text)?.[1]?.trim())
    .filter((s): s is string => s !== undefined);
}

/** One `context.path == 'literal'` term of a deploy job's `if:`. */
export interface EqualityTerm {
  readonly path: string;
  readonly value: string;
}

/**
 * Parses a deploy job's `if:` as a pure conjunction of equalities
 * (`a.b == 'x' && c.d == 'y'`). Anything else (`||`, `!`, functions,
 * comparisons other than `==`) returns undefined, and the policy rejects it:
 * a deploy condition must be simple enough to evaluate by reading it.
 */
export function parseConjunction(condition: string): EqualityTerm[] | undefined {
  const expr = condition.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
  if (expr === '') return undefined;
  const terms: EqualityTerm[] = [];
  for (const part of expr.split('&&')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*==\s*'([^']*)'\s*$/.exec(part);
    if (m?.[1] === undefined || m[2] === undefined) return undefined;
    terms.push({ path: m[1], value: m[2] });
  }
  return terms;
}

/** Evaluates a parsed conjunction against a flat context (`github.event_name` -> value). */
export function evaluateConjunction(terms: readonly EqualityTerm[], context: Readonly<Record<string, string>>): boolean {
  return terms.every((t) => context[t.path] === t.value);
}

const SHA_PIN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/;

export function checkWorkflow(file: string, source: string): PolicyFinding[] {
  // Rules are chosen by the file's name, however the caller spells its path.
  const name = file.split(/[\\/]/).pop() ?? file;
  const findings: PolicyFinding[] = [];
  const add = (line: number, rule: PolicyRule, message: string): void => {
    findings.push({ file, line, rule, message });
  };
  const lines = readLines(source);
  const jobs = readJobs(lines);
  const jobOfLine = new Map<number, Job>();
  for (const job of jobs) {
    jobOfLine.set(job.line, job);
    for (const l of job.lines) jobOfLine.set(l.no, job);
  }

  for (const line of lines) {
    const job = jobOfLine.get(line.no);
    // Only ci.yml holds the deploy jobs: a job of the same name in any other
    // workflow is treated like every other job.
    const isDeploy = name === 'ci.yml' && job !== undefined && DEPLOY_JOBS.includes(job.name);
    const content = line.inBlock ? line.text : line.text;

    if (/\t/.test(source.split('\n')[line.no - 1] ?? '')) add(line.no, 'yaml-subset', 'tab character; indent with spaces');
    if (!line.inBlock) {
      if (/(^|[\s[{,:])&[A-Za-z_]/.test(content) || /(^|[\s[{,:])\*[A-Za-z_]/.test(content) || /(^|\s)<<\s*:/.test(content)) {
        add(line.no, 'yaml-subset', 'YAML anchors, aliases and merge keys are not allowed');
      }
    }

    // Secrets: only in the deploy jobs, and only the deploy token.
    if (/\bsecrets\b/.test(content) || content.includes(DEPLOY_SECRET)) {
      if (!isDeploy) {
        add(line.no, 'secret-outside-deploy', `only ${DEPLOY_JOBS.join(' and ')} may reference secrets or ${DEPLOY_SECRET}`);
      } else {
        for (const m of content.matchAll(/\bsecrets\b(\s*\.\s*([A-Za-z0-9_]+))?/g)) {
          if (m[2] !== DEPLOY_SECRET) add(line.no, 'secret-outside-deploy', `deploy jobs may use secrets.${DEPLOY_SECRET} only`);
        }
      }
    }
    if (/\bsecrets\s*:\s*inherit\b/.test(content) || /secrets\s*\[/.test(content) || /toJSON\(\s*secrets/.test(content)) {
      add(line.no, 'secret-outside-deploy', 'secrets: inherit, secrets[...] and toJSON(secrets) are not allowed');
    }

    if (!line.inBlock) {
      const uses = /^(?:-\s+)?uses:\s*(\S+)/.exec(content);
      if (uses?.[1] !== undefined && !uses[1].startsWith('./') && !SHA_PIN.test(uses[1])) {
        add(line.no, 'unpinned-action', `'${uses[1]}' is not pinned to a full commit SHA`);
      }
      const run = /^(?:-\s+)?run:\s*(.+)$/.exec(content);
      if (run?.[1] !== undefined && run[1].includes('${{')) {
        add(line.no, 'expression-in-run', 'pass values to run: scripts through env:, never ${{ }}');
      }
      if (/^continue-on-error:\s*(?!false\b)/.test(content.replace(/^-\s+/, ''))) {
        add(line.no, 'continue-on-error', 'continue-on-error is not allowed: a failing gate must fail the run');
      }
      if (/\bwrite-all\b/.test(content)) add(line.no, 'write-permission', 'write-all is not allowed');
    } else if (line.blockKey === 'run' && line.text.includes('${{')) {
      add(line.no, 'expression-in-run', 'pass values to run: scripts through env:, never ${{ }}');
    }

    if (/\b(pull_request_target|workflow_run)\b/.test(line.inBlock ? '' : content)) {
      add(line.no, 'banned-trigger', 'pull_request_target and workflow_run run privileged code on untrusted input');
    }
  }

  // Job keys: readJobs recognises only a bare `name:` at indent 2. Any other
  // line at indent 1-3 under `jobs:` (a quoted key, a flow-mapping job, odd
  // indentation) would otherwise be read as part of the previous job, which
  // could be a deploy job allowed to name the token. Fail closed instead.
  const jobsStart = lines.findIndex((l) => !l.inBlock && l.indent === 0 && l.text === 'jobs:');
  if (jobsStart !== -1) {
    for (const line of lines.slice(jobsStart + 1)) {
      if (line.inBlock || line.text === '') continue;
      if (line.indent === 0) break;
      if (line.indent < 4 && !(line.indent === 2 && /^[A-Za-z_][A-Za-z0-9_-]*:$/.test(line.text))) {
        add(line.no, 'yaml-subset', 'a job must be declared as a bare `name:` at indent 2 with a block body');
      }
    }
  }

  // Permissions: top level read-only; write scopes only where allowed.
  const top = lines.findIndex((l) => !l.inBlock && l.indent === 0 && /^permissions:/.test(l.text));
  if (top === -1) {
    add(1, 'write-permission', 'top-level permissions: must be declared (read-only)');
  } else {
    const topLine = lines[top];
    const inline = /^permissions:\s*(.*)$/.exec(topLine?.text ?? '')?.[1]?.trim() ?? '';
    const body = inline !== '' ? [inline] : lines.slice(top + 1).filter((l, i, all) => all.slice(0, i + 1).every((x) => x.indent > 0 || x.text === '')).map((l) => l.text);
    if (body.some((t) => /:\s*write\b/.test(t))) add(topLine?.no ?? 1, 'write-permission', 'top-level permissions must be read-only');
  }
  const allowedWrites = WRITE_PERMISSIONS[name] ?? {};
  for (const job of jobs) {
    for (const line of jobBlock(job, 'permissions')) {
      const m = /^([a-z-]+):\s*write\b/.exec(line.text);
      if (m?.[1] !== undefined && !(allowedWrites[job.name] ?? []).includes(m[1])) {
        add(line.no, 'write-permission', `job '${job.name}' may not hold ${m[1]}: write`);
      }
    }
  }

  // Environments and the deploy gate.
  for (const job of jobs) {
    const env = jobScalar(job, 'environment');
    const envName = env === undefined ? undefined : env.value !== '' ? env.value : /^name:\s*(\S+)$/.exec(jobBlock(job, 'environment').find((l) => /^name:/.test(l.text))?.text ?? '')?.[1];
    if (name !== 'ci.yml' || !DEPLOY_JOBS.includes(job.name)) {
      if (env !== undefined) add(env.line, 'environment-outside-deploy', `job '${job.name}' may not use an environment`);
      continue;
    }
    const gate = jobScalar(job, 'if');
    const terms = parseConjunction(gate?.value ?? '');
    if (
      terms === undefined ||
      !terms.some((t) => t.path === 'github.event_name' && t.value === 'push') ||
      !terms.some((t) => t.path === 'github.ref' && t.value === 'refs/heads/main')
    ) {
      add(gate?.line ?? job.line, 'deploy-gate', `job '${job.name}' must run only when github.event_name == 'push' && github.ref == 'refs/heads/main'`);
    }
    const needs = listValue(job, 'needs');
    const missing = DEPLOY_NEEDS.filter((n) => !needs.includes(n));
    if (missing.length > 0) add(job.line, 'deploy-gate', `job '${job.name}' must need ${missing.join(', ')}`);
    if (envName !== DEPLOY_ENVIRONMENTS[job.name]) {
      add(env?.line ?? job.line, 'deploy-gate', `job '${job.name}' must use the protected environment '${DEPLOY_ENVIRONMENTS[job.name] ?? ''}'`);
    }
  }

  // ci.yml: verify runs on every pull request and runs the tests.
  if (name === 'ci.yml') {
    const onIndex = lines.findIndex((l) => !l.inBlock && l.indent === 0 && /^(on|"on"|'on'):/.test(l.text));
    const triggers = onIndex === -1 ? [] : lines.slice(onIndex + 1).filter((l, i, all) => all.slice(0, i + 1).every((x) => x.indent > 0 || x.text === '')).map((l) => l.text);
    if (!triggers.some((t) => /^pull_request:/.test(t))) add(onIndex + 1, 'verify-job', 'ci.yml must run on pull_request');
    const verify = jobs.find((j) => j.name === 'verify');
    if (verify === undefined) {
      add(1, 'verify-job', 'ci.yml must have a verify job');
    } else {
      if (jobScalar(verify, 'if') !== undefined) add(verify.line, 'verify-job', 'the verify job must not be conditional');
      if (!verify.lines.some((l) => /^(?:-\s+)?run:\s*pnpm (?:-r )?test\b/.test(l.text))) {
        add(verify.line, 'verify-job', 'the verify job must run the unit tests (pnpm -r test)');
      }
    }
    const e2e = jobs.find((j) => j.name === 'e2e');
    if (e2e !== undefined) {
      if (jobScalar(e2e, 'if') !== undefined) add(e2e.line, 'e2e-job', 'the e2e job must not be conditional');
      if (!listValue(e2e, 'needs').includes('build')) add(e2e.line, 'e2e-job', 'the e2e job must need build (it tests the uploaded artifact)');
      const env = jobBlock(e2e, 'env').filter((l) => !l.inBlock);
      for (const [key, value] of Object.entries(E2E_ENV)) {
        if (!env.some((l) => l.indent === 6 && l.text === `${key}: ${value}`)) {
          add(e2e.line, 'e2e-job', `the e2e job must set ${key}: ${value} in its job-level env`);
        }
      }
      // Nothing else in the job may name them: a step-level env, an inline
      // assignment or a $GITHUB_ENV write would point a step elsewhere.
      const jobLevel = new Set(env.filter((l) => l.indent === 6).map((l) => l.no));
      for (const l of e2e.lines) {
        if (!jobLevel.has(l.no) && Object.keys(E2E_ENV).some((key) => l.text.includes(key))) {
          add(l.no, 'e2e-job', 'RUN_E2E_SITE and RUN_E2E_WORKER may be set only in the e2e job-level env');
        }
      }
      let previous = 0;
      for (const step of E2E_STEPS) {
        const found = e2e.lines.find((l) => l.no > previous && l.text.replace(/^-\s+/, '') === step);
        if (found === undefined) {
          add(e2e.line, 'e2e-job', `the e2e job must run '${step}' after the steps before it`);
        } else {
          previous = found.no;
        }
      }
    }
    const fake = jobs.find((j) => j.name === 'e2e-fake-serial');
    if (fake !== undefined) {
      const flag = (line: number, message: string): void => add(line, 'fake-serial-job', message);
      if (jobScalar(fake, 'if') !== undefined) flag(fake.line, 'the e2e-fake-serial job must not be conditional');
      if (!listValue(fake, 'needs').includes('build')) flag(fake.line, 'the e2e-fake-serial job must need build (it compares against the uploaded artifact)');
      for (const l of fake.lines) {
        if (Object.keys(E2E_ENV).some((key) => l.text.includes(key))) flag(l.no, 'the e2e-fake-serial job may not name RUN_E2E_SITE or RUN_E2E_WORKER');
        if (/uses:\s*actions\/upload-artifact@/.test(l.text)) flag(l.no, 'the e2e-fake-serial job may not upload anything: the test build is never an artifact');
      }
      let previous = 0;
      for (const step of FAKE_SERIAL_STEPS) {
        const found = fake.lines.find((l) => l.no > previous && l.text.replace(/^-\s+/, '') === step);
        if (found === undefined) {
          flag(fake.line, `the e2e-fake-serial job must run '${step}' after the steps before it`);
        } else {
          previous = found.no;
        }
      }
      const build = fake.lines.find((l) => l.text.replace(/^-\s+/, '') === FAKE_SERIAL_STEPS[0]);
      const download = fake.lines.find((l) => /uses:\s*actions\/download-artifact@/.test(l.text));
      if (build !== undefined && download !== undefined && download.no < build.no) {
        flag(download.no, 'the e2e-fake-serial job must build the test artifact before it downloads anything into the checkout');
      }
    }
    checkArtifactDigests(jobs, add);
    checkRollback(jobs, add);
    checkDeployConfig(jobs, add);
    checkSmokeCredentials(jobs, add);
    for (const required of [...DEPLOY_JOBS, ...DEPLOY_NEEDS]) {
      if (!jobs.some((j) => j.name === required)) add(1, 'deploy-gate', `ci.yml must define the '${required}' job`);
    }
  }
  if (name === 'safety-review.yml') checkSafetyReviewJob(jobs, add);
  return findings;
}

/** ci.yml: the build job publishes the artifact digests and every consumer checks them (`artifact-digest`). */
function checkArtifactDigests(jobs: readonly Job[], add: (line: number, rule: PolicyRule, message: string) => void): void {
  const flag = (line: number, message: string): void => add(line, 'artifact-digest', message);
  const build = jobs.find((j) => j.name === 'build');
  if (build !== undefined) {
    const outputs = jobBlock(build, 'outputs').filter((l) => !l.inBlock);
    const upload = build.lines.find((l) => /uses:\s*actions\/upload-artifact@/.test(l.text));
    const digestsStep = build.lines.find((l) => l.text.replace(/^-\s+/, '') === 'id: digests');
    if (digestsStep === undefined) flag(build.line, "the build job must have a step with 'id: digests' that writes the artifact digests to $GITHUB_OUTPUT");
    for (const [name, file] of Object.entries(ARTIFACT_DIGESTS)) {
      if (!outputs.some((l) => l.indent === 6 && l.text === `${name}: \${{ steps.digests.outputs.${name} }}`)) {
        flag(build.line, `the build job must output ${name}: \${{ steps.digests.outputs.${name} }}`);
      }
      const writes = build.lines.find((l) => l.inBlock && l.text === `echo "${name}=$(sha256sum ${file} | cut -d' ' -f1)"`);
      if (writes === undefined || digestsStep === undefined || writes.no < digestsStep.no) {
        flag(build.line, `the digests step must write ${name} from sha256sum ${file}`);
      } else if (upload !== undefined && writes.no > upload.no) {
        flag(writes.no, 'the digests must be recorded before the artifact is uploaded');
      }
    }
  }
  for (const [name, tooLate] of Object.entries(ARTIFACT_CONSUMERS)) {
    const job = jobs.find((j) => j.name === name);
    if (job === undefined) continue;
    if (!listValue(job, 'needs').includes('build')) flag(job.line, `job '${name}' must need build (it checks the artifact against the build job's digests)`);
    const download = job.lines.find((l) => /uses:\s*actions\/download-artifact@/.test(l.text));
    const check = job.lines.find((l) => l.inBlock && l.text === DIGEST_CHECK && (download === undefined || l.no > download.no));
    if (check === undefined) {
      flag(job.line, `job '${name}' must run '${DIGEST_CHECK}' after it downloads the artifact`);
      continue;
    }
    const late = job.lines.find((l) => l.no > (download?.no ?? 0) && tooLate.test(l.text));
    if (late !== undefined && late.no < check.no) flag(late.no, `job '${name}' must check the artifact digests before it uses the artifact`);
    for (const [env, output] of Object.entries(DIGEST_ENV)) {
      const want = `${env}: \${{ needs.build.outputs.${output} }}`;
      const line = job.lines.find((l) => !l.inBlock && l.text === want);
      if (line === undefined || line.no > check.no || (download !== undefined && line.no < download.no)) {
        flag(job.line, `job '${name}' must pass ${want} to its digest check step`);
      }
    }
  }
}

/** The exact condition of the undo step. */
export const ROLLBACK_IF = "if: failure() && steps.deploy.outcome == 'success'";

/** ci.yml: a deploy whose later steps fail is undone (`deploy-rollback`). */
function checkRollback(jobs: readonly Job[], add: (line: number, rule: PolicyRule, message: string) => void): void {
  for (const name of DEPLOY_JOBS) {
    const job = jobs.find((j) => j.name === name);
    if (job === undefined) continue;
    const env = DEPLOY_ENVIRONMENTS[name] ?? '';
    const flag = (line: number, message: string): void => add(line, 'deploy-rollback', message);
    const text = (l: Line): string => l.text.replace(/^-\s+/, '');
    const deployId = job.lines.find((l) => !l.inBlock && text(l) === 'id: deploy');
    const wrangler = job.lines.find((l) => /wrangler deploy /.test(l.text));
    const smoke = job.lines.find((l) => text(l) === `run: node tools/gates/src/smoke/cli.ts --env ${env}`);
    const undo = job.lines.find((l) => text(l) === `run: node tools/gates/src/deploy/rollback-cli.ts ${env} ci/deploy-toolchain/node_modules/.bin/wrangler`);
    if (deployId === undefined || wrangler === undefined || wrangler.no < deployId.no) {
      flag(job.line, `job '${name}': the step that runs wrangler deploy must have 'id: deploy'`);
    }
    if (undo === undefined) {
      flag(job.line, `job '${name}' must run rollback-cli.ts ${env} when a step after the deploy fails`);
      continue;
    }
    if (smoke === undefined || undo.no < smoke.no) flag(undo.no, `job '${name}': the undo step must come after the smoke test`);
    // The step's `if:` is the nearest step-level `if:` above its run line within the same step.
    const stepStart = [...job.lines].reverse().find((l) => !l.inBlock && l.no < undo.no && /^-\s+name:/.test(l.text));
    const cond = job.lines.find((l) => !l.inBlock && l.no > (stepStart?.no ?? 0) && l.no < undo.no && /^if:/.test(text(l)));
    if (cond === undefined || text(cond) !== ROLLBACK_IF) flag(undo.no, `job '${name}': the undo step must run under exactly ${ROLLBACK_IF}`);
  }
}

/** The deployment configuration the preflight writes and wrangler is given (`deploy-config`). */
export const DEPLOY_CONFIG = 'workers/run/wrangler.deploy.json';

/** The exact preflight line of a deploy job. */
export function preflightLine(env: string): string {
  return `run: node tools/gates/src/deploy/preflight.ts workers/run/wrangler.jsonc ${env} --write ${DEPLOY_CONFIG}`;
}

/**
 * ci.yml: each deploy job writes the allowlisted deployment configuration in
 * its preflight and every wrangler invocation uses only that file
 * (`deploy-config`, P0-04 review). wrangler runs a configured custom build
 * even under --no-bundle, in this job, with the deploy token.
 */
function checkDeployConfig(jobs: readonly Job[], add: (line: number, rule: PolicyRule, message: string) => void): void {
  for (const name of DEPLOY_JOBS) {
    const job = jobs.find((j) => j.name === name);
    if (job === undefined) continue;
    const env = DEPLOY_ENVIRONMENTS[name] ?? '';
    const flag = (line: number, message: string): void => add(line, 'deploy-config', message);
    const text = (l: Line): string => l.text.replace(/^-\s+/, '');
    const preflight = job.lines.find((l) => !l.inBlock && text(l) === preflightLine(env));
    if (preflight === undefined) flag(job.line, `job '${name}' must run exactly '${preflightLine(env)}'`);
    // A wrangler invocation: the word wrangler followed by a subcommand. The undo step's
    // `rollback-cli.ts <env> .../wrangler` passes the binary path only (its plan uses DEPLOY_CONFIG).
    const invocations = job.lines.filter((l) => /(^|[\s/])wrangler\s+[a-z]/.test(l.text) && !/^(?:-\s+)?name:/.test(l.text));
    let deploys = 0;
    for (const l of invocations) {
      if (/\bwrangler\s+deploy\b/.test(l.text)) deploys += 1;
      if (!l.text.includes(`--config ${DEPLOY_CONFIG}`)) flag(l.no, `job '${name}': every wrangler invocation must pass --config ${DEPLOY_CONFIG}`);
      if (preflight === undefined || l.no < preflight.no) flag(l.no, `job '${name}': wrangler may run only after the preflight wrote ${DEPLOY_CONFIG}`);
    }
    if (deploys === 0) flag(job.line, `job '${name}' must deploy with wrangler deploy --config ${DEPLOY_CONFIG}`);
    for (const l of job.lines) {
      if (l === preflight || invocations.includes(l)) continue;
      if (l.text.includes('wrangler.deploy.json')) flag(l.no, `job '${name}': only the preflight may write ${DEPLOY_CONFIG}`);
      if (l.text.includes('wrangler.jsonc')) flag(l.no, `job '${name}': only the preflight may read workers/run/wrangler.jsonc; wrangler gets ${DEPLOY_CONFIG}`);
    }
  }
}

/** The step env every smoke-test step in a deploy job must declare (`smoke-credentials`). */
export const SMOKE_CREDENTIALS: Readonly<Record<string, string>> = {
  CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
  CLOUDFLARE_ACCOUNT_ID: '${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
};

/** The lines of the step that contains `line` (from its `- ` line to the next step at the same indent). */
function stepOf(job: Job, line: Line): Line[] {
  const index = job.lines.indexOf(line);
  let start = index;
  while (start >= 0) {
    const l = job.lines[start] as Line;
    if (!l.inBlock && l.text.startsWith('- ')) break;
    start -= 1;
  }
  if (start < 0) return [];
  const indent = (job.lines[start] as Line).indent;
  const out: Line[] = [];
  for (const l of job.lines.slice(start)) {
    if (out.length > 0 && !l.inBlock && l.text !== '' && (l.indent < indent || (l.indent === indent && l.text.startsWith('- ')))) break;
    out.push(l);
  }
  return out;
}

/**
 * ci.yml: every step of a deploy job that runs the smoke test (the staging
 * pre-deploy Access check included) passes the Cloudflare token and account
 * in its own env (`smoke-credentials`). A step's env is not inherited by the
 * next step; the positive Access check refuses without them, so a missing
 * entry would stop every staging deploy (P0 review regression). The staging
 * job must run the pre-deploy check.
 */
function checkSmokeCredentials(jobs: readonly Job[], add: (line: number, rule: PolicyRule, message: string) => void): void {
  for (const name of DEPLOY_JOBS) {
    const job = jobs.find((j) => j.name === name);
    if (job === undefined) continue;
    const flag = (line: number, message: string): void => add(line, 'smoke-credentials', message);
    const smokeLines = job.lines.filter((l) => l.text.includes('tools/gates/src/smoke/cli.ts'));
    if (name === 'deploy-staging' && !smokeLines.some((l) => l.text.replace(/^-\s+/, '') === 'run: node tools/gates/src/smoke/cli.ts --env staging --pre-deploy')) {
      flag(job.line, "job 'deploy-staging' must run 'node tools/gates/src/smoke/cli.ts --env staging --pre-deploy' (the positive Access check, D31)");
    }
    for (const smoke of smokeLines) {
      const step = stepOf(job, smoke);
      for (const [key, value] of Object.entries(SMOKE_CREDENTIALS)) {
        if (!step.some((l) => !l.inBlock && l.text === `${key}: ${value}`)) {
          flag(smoke.no, `job '${name}': the smoke-test step must set ${key}: ${value} in its env (step env is not inherited)`);
        }
      }
    }
  }
}

/** Lines safety-review.yml must contain, in this order (each a whole line, `- ` prefix ignored). */
export const SAFETY_REVIEW_LINES: readonly string[] = [
  'ref: ${{ github.event.pull_request.base.sha }}',
  'gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/reviews" --paginate --slurp > "$RUNNER_TEMP/reviews.json"',
  'gh api "repos/$GITHUB_REPOSITORY/collaborators/$login/permission"',
  'node tools/gates/src/review/cli.ts \\',
  '--permissions "$RUNNER_TEMP/permissions.json" \\',
];

/**
 * safety-review.yml: the gate runs from the base commit and is given the
 * reviewers' actual repository permissions (`safety-review-job`). This only
 * checks the file as committed: a pull request can edit this policy as well,
 * so the primary control is GitHub's native branch protection (required
 * approvals from reviewers with write access, Code Owner review of .github/
 * and tools/gates/; docs/ops/branch-protection.md).
 */
function checkSafetyReviewJob(jobs: readonly Job[], add: (line: number, rule: PolicyRule, message: string) => void): void {
  const job = jobs.find((j) => j.name === 'safety-review');
  if (job === undefined) {
    add(1, 'safety-review-job', "safety-review.yml must define the 'safety-review' job");
    return;
  }
  let previous = 0;
  for (const want of SAFETY_REVIEW_LINES) {
    const found = job.lines.find((l) => l.no > previous && l.text.replace(/^-\s+/, '').includes(want) && (want.startsWith('ref:') ? l.text.replace(/^-\s+/, '') === want : true));
    if (found === undefined) add(job.line, 'safety-review-job', `the safety-review job must contain '${want}' after the lines before it`);
    else previous = found.no;
  }
  for (const l of job.lines) {
    if (!l.inBlock && /^(?:-\s+)?ref:/.test(l.text) && l.text.replace(/^-\s+/, '') !== SAFETY_REVIEW_LINES[0]) {
      add(l.no, 'safety-review-job', 'the safety-review job may check out only the base commit');
    }
  }
}
