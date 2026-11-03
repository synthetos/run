/**
 * The run Worker's upstream origins: the reviewed allowance for `scheme://`
 * literals in workers/run/src (OD-10).
 *
 * The bundle scan admits only run's own origins in the web bundle
 * (tools/gates/src/bundle/scan.ts, `origin-literal`), and the Worker is not
 * part of that bundle: it is server-side code that may fetch from elsewhere
 * on the page's behalf. So the Worker gets its own, narrower rule: every
 * string or template literal in its source that holds a URL scheme must be
 * one of the entries below, by file and by text. A new upstream is a
 * reviewed change here, and a test (tools/gates/test/worker-upstreams.test.ts)
 * fails on anything else, including a copy of an allowed literal in another
 * file.
 *
 * Comments are not scanned (they are prose); the scan reads the TypeScript
 * AST, so a URL assembled from pieces is a `scheme://` only if written as one.
 */
import ts from 'typescript';

export interface WorkerUpstream {
  /** File name inside workers/run/src. */
  readonly file: string;
  /** The literal's text as written (a template's static text keeps its `${...}` holes). */
  readonly text: string;
  readonly why: string;
}

export const WORKER_UPSTREAMS: readonly WorkerUpstream[] = Object.freeze([
  {
    file: 'accessIdentity.ts',
    text: 'https://${config.teamDomain}/cdn-cgi/access/certs',
    why: 'The Cloudflare Access team domain’s signing certificates (P1-05, docs/ops/access.md).',
  },
  {
    file: 'accessIdentity.ts',
    text: 'https://${config.teamDomain}',
    why: 'The Access JWT issuer, compared, never fetched (P1-05).',
  },
  {
    file: 'firmwareProxy.ts',
    text: 'https://github.com',
    why: 'GitHub release downloads of the allowlisted synthetos repositories, fetched server-side and verified against the signed release list (OD-10).',
  },
]);

export interface OriginLiteral {
  readonly file: string;
  readonly text: string;
  readonly line: number;
}

const SCHEME_RE = /[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** The text of a template literal with its holes written as `${...}`. */
function templateText(node: ts.TemplateExpression): string {
  let out = node.head.text;
  for (const span of node.templateSpans) out += `\${${span.expression.getText()}}${span.literal.text}`;
  return out;
}

/** Every string or template literal of a source file that holds `scheme://`. */
export function originLiterals(file: string, source: string): OriginLiteral[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: OriginLiteral[] = [];
  const visit = (node: ts.Node): void => {
    let text: string | undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = templateText(node);
    if (text !== undefined && SCHEME_RE.test(text)) out.push({ file, text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
