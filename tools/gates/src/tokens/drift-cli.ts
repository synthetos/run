/**
 * pnpm tokens:drift --site <path to a synthetos.com clone> [--upstream <ref>]
 *
 * 1. Fails (exit 1) unless the theme tokens in apps/web/src/styles/tokens.css
 *    equal the site's tokens at the ref pinned in tokens.pin.json.
 * 2. With --upstream (for example `origin/main`), also fails when the site's
 *    tokens at that ref differ from the pinned ref: the site has changed its
 *    theme, so the copy and the pin should move together.
 *
 * The clone is only read (`git show`); nothing is fetched or changed. Exit 2:
 * the check could not run (no clone, unknown ref).
 */
import { execFileSync } from 'node:child_process';
import { compareThemes, formatDrift, siteThemes, type SiteSources } from './drift.ts';
import { loadPin, loadThemes, type TokenPin } from './theme.ts';

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function show(site: string, ref: string, file: string): string {
  return execFileSync('git', ['-C', site, 'show', `${ref}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function sources(site: string, ref: string, pin: TokenPin): SiteSources {
  return { light: show(site, ref, pin.light.file), dark: show(site, ref, pin.dark.file) };
}

function main(argv: readonly string[]): number {
  const site = arg(argv, '--site');
  if (site === undefined) {
    process.stderr.write('usage: tokens:drift --site <path to a synthetos.com clone> [--upstream <ref>]\n');
    return 2;
  }
  let pin: TokenPin;
  let pinned: ReturnType<typeof siteThemes>;
  try {
    pin = loadPin();
    pinned = siteThemes(pin, sources(site, pin.ref, pin));
  } catch (error) {
    process.stderr.write(`tokens:drift: could not read the site at the pinned ref: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  let status = 0;
  const copy = compareThemes(pin, pinned, loadThemes());
  if (copy.length > 0) {
    process.stderr.write(`tokens:drift: tokens.css differs from ${pin.repository}@${pin.ref.slice(0, 12)}:\n${formatDrift(copy)}\n`);
    status = 1;
  } else {
    process.stdout.write(`tokens:drift: ${pin.copied.length} theme tokens match ${pin.repository}@${pin.ref.slice(0, 12)} in both themes\n`);
  }
  const upstream = arg(argv, '--upstream');
  if (upstream !== undefined) {
    try {
      const moved = compareThemes(pin, siteThemes(pin, sources(site, upstream, pin)), pinned);
      if (moved.length > 0) {
        process.stderr.write(`tokens:drift: the site's tokens at ${upstream} differ from the pin (site | pinned):\n${formatDrift(moved)}\n`);
        status = 1;
      } else {
        process.stdout.write(`tokens:drift: the site's tokens at ${upstream} are unchanged since the pin\n`);
      }
    } catch (error) {
      process.stderr.write(`tokens:drift: could not read the site at ${upstream}: ${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
  }
  return status;
}

process.exitCode = main(process.argv.slice(2));
