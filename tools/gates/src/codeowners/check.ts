/**
 * CODEOWNERS check (ROADMAP P0-03 acceptance: "A CI check fails if a
 * CODEOWNERS path from SAFETY §8 is missing").
 *
 * The required paths are read from the in-repo `SAFETY.md` §8, so the list
 * has one source. Each required path must:
 * - appear in `.github/CODEOWNERS` as its own pattern (`/path` or `path`);
 * - be owned by the owner on the line that wins for it (in CODEOWNERS the
 *   last matching line wins, so a later broader line could take it away).
 * Every CODEOWNERS line must also be one GitHub accepts: an unsupported
 * pattern or a malformed owner makes GitHub skip the line silently.
 *
 * Dependency-free.
 */
import { isSupportedPattern, matches, samplePath } from '../shared/glob.ts';

/** The owner who must review the safety paths (SAFETY §8). */
export const SAFETY_OWNER = '@ril3y';

/** Paths ROADMAP P0-03 adds to the SAFETY §8 list. */
export const ADDITIONAL_REQUIRED_PATHS: readonly string[] = ['vendor/tinyg-hil-tables/**', 'pnpm-lock.yaml'];

export interface OwnerRule {
  readonly line: number;
  readonly pattern: string;
  readonly owners: readonly string[];
}

const OWNER_RE = /^(?:@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9._-]+)?|[^@\s]+@[^@\s]+\.[^@\s]+)$/;

/**
 * The paths listed in SAFETY §8 after "CODEOWNERS makes the owner a required
 * reviewer for:", one per bullet, as the first `code` span of each bullet.
 */
export function safetySection8Paths(safetyMd: string): string[] {
  const lines = safetyMd.split('\n');
  const heading = lines.findIndex((l) => /^## 8\. Safety review checklist\s*$/.test(l));
  if (heading === -1) throw new Error('SAFETY.md has no "## 8. Safety review checklist" section');
  const intro = lines.findIndex((l, i) => i > heading && l.includes('CODEOWNERS makes the owner a required reviewer for:'));
  if (intro === -1) throw new Error('SAFETY.md §8 has no CODEOWNERS list');
  const paths: string[] = [];
  for (let i = intro + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line.startsWith('- ')) break;
    const code = /`([^`]+)`/.exec(line);
    if (code?.[1] === undefined) throw new Error(`SAFETY.md §8 bullet without a path: ${line}`);
    paths.push(code[1]);
  }
  if (paths.length === 0) throw new Error('SAFETY.md §8 CODEOWNERS list is empty');
  return paths;
}

export interface ParsedCodeowners {
  readonly rules: readonly OwnerRule[];
  readonly errors: readonly string[];
}

export function parseCodeowners(text: string): ParsedCodeowners {
  const rules: OwnerRule[] = [];
  const errors: string[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = index + 1;
    const content = raw.replace(/\s+#.*$/, '').trim();
    if (content === '' || content.startsWith('#')) return;
    const [pattern = '', ...owners] = content.split(/\s+/);
    if (!isSupportedPattern(pattern)) errors.push(`line ${line}: unsupported pattern '${pattern}' (GitHub would ignore this line)`);
    if (owners.length === 0) errors.push(`line ${line}: '${pattern}' has no owner, which removes any required reviewer`);
    for (const owner of owners) {
      if (!OWNER_RE.test(owner)) errors.push(`line ${line}: malformed owner '${owner}' (GitHub would ignore this line)`);
    }
    rules.push({ line, pattern, owners });
  });
  return { rules, errors };
}

/** The rule GitHub applies to `path`: the last one whose pattern matches. */
export function effectiveRule(rules: readonly OwnerRule[], path: string): OwnerRule | undefined {
  let winner: OwnerRule | undefined;
  for (const rule of rules) if (isSupportedPattern(rule.pattern) && matches(rule.pattern, path)) winner = rule;
  return winner;
}

function normalise(pattern: string): string {
  return pattern.startsWith('/') ? pattern.slice(1) : pattern;
}

/** All problems with `codeowners` against the required paths. Empty means it passes. */
export function checkCodeowners(codeowners: string, requiredPaths: readonly string[], owner = SAFETY_OWNER): string[] {
  const { rules, errors } = parseCodeowners(codeowners);
  const problems = [...errors];
  for (const required of requiredPaths) {
    const listed = rules.find((r) => normalise(r.pattern) === normalise(required));
    if (listed === undefined) {
      problems.push(`missing: '${required}' (SAFETY §8) is not listed in CODEOWNERS`);
      continue;
    }
    if (!listed.owners.includes(owner)) {
      problems.push(`line ${listed.line}: '${required}' is not owned by ${owner}`);
    }
    for (const path of [normalise(required).includes('*') ? samplePath(required) : normalise(required), samplePath(required)]) {
      const winner = effectiveRule(rules, path);
      if (winner !== undefined && !winner.owners.includes(owner)) {
        problems.push(`line ${winner.line}: '${winner.pattern}' overrides '${required}' for ${path} without ${owner}`);
      }
    }
  }
  return [...new Set(problems)];
}
