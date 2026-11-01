/**
 * Path patterns with CODEOWNERS (gitignore-style) semantics, used by the
 * CODEOWNERS check and the safety-review check (ROADMAP P0-03).
 *
 * - A leading `/`, or a `/` anywhere but the end, anchors the pattern to the
 *   repository root; otherwise it matches at any depth.
 * - A trailing `/` matches a directory and everything under it.
 * - `*` matches within one path segment, `**` across segments, `?` one
 *   character other than `/`.
 * - A pattern that names a directory also matches every file under it.
 *
 * Negation (`!`), character classes (`[...]`) and escapes are rejected:
 * GitHub's CODEOWNERS does not support them, and a silently ignored line
 * would drop a required reviewer.
 *
 * Dependency-free.
 */

const UNSUPPORTED = /[![\]\\]/;

export function isSupportedPattern(pattern: string): boolean {
  return pattern !== '' && !UNSUPPORTED.test(pattern) && !pattern.includes('***');
}

function escape(char: string): string {
  return /[.+^${}()|]/.test(char) ? `\\${char}` : char;
}

export function patternToRegExp(pattern: string): RegExp {
  if (!isSupportedPattern(pattern)) throw new Error(`unsupported path pattern '${pattern}'`);
  let p = pattern;
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith('/') || p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);

  let body = '';
  for (let i = 0; i < p.length; i++) {
    const char = p[i] ?? '';
    if (char === '*' && p[i + 1] === '*') {
      const atStart = i === 0;
      const followedBySlash = p[i + 2] === '/';
      if (atStart && followedBySlash) {
        body += '(?:.*/)?';
        i += 2;
      } else {
        body += '.*';
        i += 1;
      }
    } else if (char === '*') {
      body += '[^/]*';
    } else if (char === '?') {
      body += '[^/]';
    } else {
      body += escape(char);
    }
  }
  const prefix = anchored ? '^' : '^(?:.*/)?';
  const suffix = dirOnly ? '/.*$' : '(?:/.*)?$';
  return new RegExp(`${prefix}${body}${suffix}`);
}

export function matches(pattern: string, path: string): boolean {
  return patternToRegExp(pattern).test(path);
}

/**
 * A concrete repository path that the pattern is meant to cover, used to
 * check which CODEOWNERS rule wins for it: `**` and a trailing `/` become a
 * nested file, `*` becomes a sample segment.
 */
export function samplePath(pattern: string): string {
  let p = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  if (p.endsWith('/')) p = `${p}sample/file.ts`;
  return p.replace(/\*\*/g, 'sample/file.ts').replace(/\*/g, 'Sample').replace(/\?/g, 'x');
}
