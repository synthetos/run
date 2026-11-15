import type { Rule } from 'eslint';
import { isNode, unwrap, type AnyNode } from '../ast.ts';
import { recorder, RATCHET_MESSAGES } from '../../modularity/ratchet.ts';

/** Function-valued properties and references count; spreads are followed when locally resolvable. */
function methods(node: AnyNode, context: Rule.RuleContext, seen = new Set<AnyNode>()): number {
  if (seen.has(node)) return 0;
  seen.add(node);
  const values = (node['properties'] ?? (node['body'] as AnyNode | undefined)?.['body'] ?? []) as AnyNode[];
  return values.reduce((sum, member) => sum + memberMethods(member, context, seen), 0);
}
function definition(node: AnyNode, context: Rule.RuleContext): AnyNode | undefined {
  const scope = context.sourceCode.getScope(node as Rule.Node);
  let current: typeof scope | null = scope;
  while (current) {
    const variable = current.set.get(String(node['name']));
    const def = variable?.defs[0];
    if (def) return def.type === 'Variable' ? unwrap((def.node as unknown as AnyNode)['init']) as AnyNode : def.node as unknown as AnyNode;
    current = current.upper;
  }
  return undefined;
}
function callable(node: unknown, context: Rule.RuleContext, seen: Set<AnyNode>): boolean {
  const value = unwrap(node);
  if (!isNode(value) || seen.has(value)) return false;
  if (['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(value.type)) return true;
  if (value.type !== 'Identifier') return false;
  const resolved = definition(value, context);
  // Imported references can be callable; count conservatively rather than bypass by shorthand.
  if (resolved?.type === 'ImportSpecifier' || resolved?.type === 'ImportDefaultSpecifier') return true;
  seen.add(value);
  return callable(resolved, context, seen);
}
function memberMethods(member: AnyNode, context: Rule.RuleContext, seen: Set<AnyNode>): number {
  if (member.type === 'MethodDefinition') return member['kind'] === 'constructor' ? 0 : 1;
  if (member.type === 'SpreadElement') {
    const arg = unwrap(member['argument']);
    const target = isNode(arg) && arg.type === 'Identifier' ? definition(arg, context) : arg;
    return isNode(target) && target.type === 'ObjectExpression' ? methods(target, context, seen) : 0;
  }
  return callable(member['value'], context, new Set()) ? 1 : 0;
}
export const oversizedStructure: Rule.RuleModule = {
  meta: { type: 'suggestion', docs: { description: 'Limit callable members to 15 and switch cases (including default) to 25.' }, schema: [], messages: RATCHET_MESSAGES },
  create(context) {
    const result = recorder(context, ['max-methods', 'max-switch-cases']);
    const check = (node: Rule.Node): void => {
      const count = methods(node as AnyNode, context);
      if (count > 15) result.record('max-methods', count, node);
    };
    return {
      ObjectExpression: check, ClassDeclaration: check, ClassExpression: check,
      SwitchStatement(node: Rule.Node) {
        const count = ((node as unknown as AnyNode)['cases'] as unknown[]).length;
        if (count > 25) result.record('max-switch-cases', count, node);
      },
      'Program:exit': () => result.finish(),
    };
  },
};
