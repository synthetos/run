/**
 * CODEOWNERS (ROADMAP P0-03 acceptance: "A CI check fails if a CODEOWNERS
 * path from SAFETY §8 is missing").
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADDITIONAL_REQUIRED_PATHS,
  checkCodeowners,
  effectiveRule,
  parseCodeowners,
  safetySection8Paths,
  SAFETY_OWNER,
} from '../src/codeowners/check.ts';
import { matches, samplePath } from '../src/shared/glob.ts';
import { REPO_ROOT, ScratchRepo } from './scratch.ts';

const SAFETY = readFileSync(join(REPO_ROOT, 'SAFETY.md'), 'utf8');
const CODEOWNERS = readFileSync(join(REPO_ROOT, '.github/CODEOWNERS'), 'utf8');
const SECTION_8 = safetySection8Paths(SAFETY);
const REQUIRED = [...SECTION_8, ...ADDITIONAL_REQUIRED_PATHS];

describe('the SAFETY §8 list', () => {
  it('is read from the in-repo SAFETY.md, exactly as §8 lists it', () => {
    expect(SECTION_8).toEqual([
      'SAFETY.md',
      'packages/safety/src/strings.ts',
      'packages/safety/src/allowMatrix.ts',
      'packages/protocol/src/dialects/**',
      'packages/schema/allowlists/**',
      'packages/machine/src/stop*.ts',
      'packages/flasher/**',
      'safety-advisory.json',
      'firmware/manifest.json',
      'workers/run/src/headers.ts',
    ]);
  });

  it('fails loudly if §8 or its list disappears', () => {
    expect(() => safetySection8Paths('# nothing here\n')).toThrow(/§8|Safety review checklist/);
    expect(() => safetySection8Paths('## 8. Safety review checklist\n\nno list\n')).toThrow(/CODEOWNERS list/);
  });
});

describe('the real CODEOWNERS', () => {
  it('owns every required path', () => {
    expect(checkCodeowners(CODEOWNERS, REQUIRED)).toEqual([]);
  });

  it.each(REQUIRED)('fails when %s is removed', (path) => {
    const lines = CODEOWNERS.split('\n').filter((l) => l.split(/\s+/)[0] !== `/${path}`);
    expect(lines.length).toBe(CODEOWNERS.split('\n').length - 1);
    const problems = checkCodeowners(lines.join('\n'), REQUIRED);
    expect(problems).toContain(`missing: '${path}' (SAFETY §8) is not listed in CODEOWNERS`);
  });

  it('fails when a later, broader line takes a path away from the owner', () => {
    const problems = checkCodeowners(`${CODEOWNERS}\n/packages/ @someone-else\n`, REQUIRED);
    expect(problems.some((p) => p.includes("'/packages/' overrides 'packages/flasher/**'"))).toBe(true);
    expect(problems.some((p) => p.includes("overrides 'packages/machine/src/stop*.ts'"))).toBe(true);
  });

  it('fails when a required path names someone else', () => {
    const problems = checkCodeowners(CODEOWNERS.replace('/SAFETY.md                          @ril3y', '/SAFETY.md @someone-else'), REQUIRED);
    expect(problems.some((p) => p.includes(`'SAFETY.md' is not owned by ${SAFETY_OWNER}`))).toBe(true);
  });

  it('fails on lines GitHub would silently ignore', () => {
    expect(checkCodeowners(`${CODEOWNERS}\n!/packages/flasher/ @ril3y\n`, REQUIRED).some((p) => p.includes('unsupported pattern'))).toBe(true);
    expect(checkCodeowners(`${CODEOWNERS}\n/docs/ ril3y\n`, REQUIRED).some((p) => p.includes('malformed owner'))).toBe(true);
    expect(checkCodeowners(`${CODEOWNERS}\n/docs/\n`, REQUIRED).some((p) => p.includes('has no owner'))).toBe(true);
  });

  it('the CLI fails on a scratch copy with a SAFETY §8 path removed', { timeout: 60_000 }, () => {
    const repo = ScratchRepo.create();
    try {
      expect(repo.gate('tools/gates/src/codeowners/cli.ts').status).toBe(0);
      repo.write('.github/CODEOWNERS', CODEOWNERS.replace(/^\/workers\/run\/src\/headers\.ts.*\n/m, ''));
      const result = repo.gate('tools/gates/src/codeowners/cli.ts');
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("missing: 'workers/run/src/headers.ts'");
    } finally {
      repo.dispose();
    }
  });
});

describe('CODEOWNERS patterns', () => {
  it('match like GitHub: anchoring, directories, * and **', () => {
    expect(matches('/packages/flasher/**', 'packages/flasher/src/hex.ts')).toBe(true);
    expect(matches('/packages/flasher/**', 'other/packages/flasher/x.ts')).toBe(false);
    expect(matches('/packages/machine/src/stop*.ts', 'packages/machine/src/stopJob.ts')).toBe(true);
    expect(matches('/packages/machine/src/stop*.ts', 'packages/machine/src/sub/stopJob.ts')).toBe(false);
    expect(matches('/.github/', '.github/workflows/ci.yml')).toBe(true);
    expect(matches('/.github/', '.github')).toBe(false);
    expect(matches('*.md', 'docs/x/README.md')).toBe(true);
    expect(matches('docs', 'a/docs/b.md')).toBe(true);
    expect(matches('/SAFETY.md', 'SAFETY.md')).toBe(true);
    expect(matches('/SAFETY.md', 'docs/SAFETY.md')).toBe(false);
    expect(matches('/SAFETY.md', 'SAFETY.mdx')).toBe(false);
    expect(matches('**/dialects/**', 'packages/protocol/src/dialects/en.ts')).toBe(true);
  });

  it('gives concrete sample paths for the override check', () => {
    expect(samplePath('packages/flasher/**')).toBe('packages/flasher/sample/file.ts');
    expect(samplePath('/packages/machine/src/stop*.ts')).toBe('packages/machine/src/stopSample.ts');
    expect(samplePath('/.github/')).toBe('.github/sample/file.ts');
  });

  it('applies the last matching rule', () => {
    const { rules } = parseCodeowners('/packages/ @a\n/packages/safety/ @b\n');
    expect(effectiveRule(rules, 'packages/safety/src/x.ts')?.owners).toEqual(['@b']);
    expect(effectiveRule(rules, 'packages/machine/src/x.ts')?.owners).toEqual(['@a']);
    expect(effectiveRule(rules, 'apps/web/x.ts')).toBeUndefined();
  });
});
