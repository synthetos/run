import type { Rule } from 'eslint';
import { type AnyNode, isNode, staticName } from '../ast.ts';

/**
 * Refuses an `import()` whose specifier is not a literal string (P0 review
 * fix pass, P0-14). dependency-cruiser sees only literal specifiers, so a
 * computed one (`import(path)`, `` import(`./${n}.ts`) ``, `import('./' + n)`)
 * is an edge no layering, test-kit or network rule can check. A literal
 * `import('./x.ts')` stays allowed: its edge is in the graph and checked.
 */
export const noDynamicImport: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Ban import() with a computed specifier: its edge cannot be checked (P0-14).' },
    schema: [],
    messages: {
      dynamic:
        'import() must name its module with a literal string. A computed specifier is an import edge that ' +
        'dependency-cruiser cannot see or check (P0 review, P0-14).',
    },
  },
  create(context) {
    return {
      ImportExpression(node: Rule.Node) {
        const source = (node as unknown as AnyNode)['source'];
        if (isNode(source) && staticName(source, true) !== undefined) return;
        context.report({ node, messageId: 'dynamic' });
      },
    };
  },
};
