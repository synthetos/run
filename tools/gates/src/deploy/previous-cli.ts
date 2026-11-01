/**
 * Previous-deployment selection for the deploy jobs (ROADMAP P0-04; see
 * previous.ts).
 *
 *   node tools/gates/src/deploy/previous-cli.ts select <artifacts.json> <env> <repository-id>
 *     prints the run id of the newest trusted `run-deployed-<env>` artifact,
 *     or nothing when there is none (exit 0 either way)
 *   node tools/gates/src/deploy/previous-cli.ts check-run <run.json> <run-id> <repository-id>
 *     exit 0 when that run may be trusted, 1 when not
 *   node tools/gates/src/deploy/previous-cli.ts commits <retention.json>
 *     prints the full commit shas the previous state names, one per line
 *   node tools/gates/src/deploy/previous-cli.ts select-build <runs.json> <commit> <repository-id>
 *     prints the id of the trusted run that built that commit, or nothing
 *
 * Exit status 2: the command could not run.
 */
import { readFileSync } from 'node:fs';
import { checkPreviousRun, deployedArtifactName, selectBuildRun, selectPreviousRun } from './previous.ts';
import { parseState, stateCommits } from './retention.ts';
import { isDeployEnvironment } from './wranglerConfig.ts';

function int(value: string | undefined, what: string): number {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) throw new Error(`${what} must be a positive integer`);
  return Number(value);
}

function main(argv: readonly string[]): number {
  const [command, file, third, fourth] = argv;
  try {
    if (command === 'select' && file !== undefined && argv.length === 4) {
      if (third === undefined || !isDeployEnvironment(third)) throw new Error('unknown environment');
      const runId = selectPreviousRun(JSON.parse(readFileSync(file, 'utf8')), deployedArtifactName(third), int(fourth, 'repository id'));
      if (runId !== null) process.stdout.write(`${runId}\n`);
      return 0;
    }
    if (command === 'check-run' && file !== undefined && argv.length === 4) {
      const problems = checkPreviousRun(JSON.parse(readFileSync(file, 'utf8')), int(third, 'run id'), int(fourth, 'repository id'));
      if (problems.length > 0) {
        process.stderr.write('previous deployment: refused\n');
        for (const p of problems) process.stderr.write(`  ${p}\n`);
        return 1;
      }
      return 0;
    }
    if (command === 'commits' && file !== undefined && argv.length === 2) {
      for (const c of stateCommits(parseState(readFileSync(file, 'utf8')))) process.stdout.write(`${c}\n`);
      return 0;
    }
    if (command === 'select-build' && file !== undefined && third !== undefined && argv.length === 4) {
      const runId = selectBuildRun(JSON.parse(readFileSync(file, 'utf8')), third, int(fourth, 'repository id'));
      if (runId !== null) process.stdout.write(`${runId}\n`);
      return 0;
    }
    process.stderr.write(
      'usage: previous-cli.ts select <artifacts.json> <env> <repo-id> | check-run <run.json> <run-id> <repo-id> | commits <retention.json> | select-build <runs.json> <commit> <repo-id>\n',
    );
    return 2;
  } catch (error) {
    process.stderr.write(`previous deployment: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
