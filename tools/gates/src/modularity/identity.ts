import type { Rule, SourceCode } from 'eslint';
import { isNode, type AnyNode } from '../eslint/ast.ts';

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const OWNERS = new Set([...FUNCTIONS, 'ClassDeclaration', 'ClassExpression', 'ObjectExpression', 'StaticBlock', 'PropertyDefinition']);
function text(node: unknown, source: SourceCode): string {
  if (!isNode(node)) return '?';
  if (node.type === 'Identifier' || node.type === 'PrivateIdentifier') return String(node['name']);
  return source.getText(node as Rule.Node).replace(/\s+/g, ' ').slice(0, 160);
}
/** Function expressions for methods share one identity across all core metrics. */
function normalize(node: AnyNode): AnyNode {
  if (node.type === 'Property' || node.type === 'MethodDefinition') {
    const value = node['value'];
    if (isNode(value) && FUNCTIONS.has(value.type)) return value;
  }
  return node;
}
function owner(node: AnyNode): AnyNode | undefined {
  let parent = node.parent;
  while (parent && parent.type !== 'Program') {
    if (OWNERS.has(parent.type)) return parent;
    parent = parent.parent;
  }
  return undefined;
}
function callLabel(node: AnyNode, child: AnyNode, parent: AnyNode, source: SourceCode): string {
  const args = parent['arguments'] as AnyNode[];
  const first = args[0];
  const title = first?.type === 'Literal' ? text(first, source) : '';
  return `${node.type}:${text(parent['callee'], source)}(${title})[${args.indexOf(child)}]`;
}
function expressionParent(node: AnyNode) {
  let child = node, parent = node.parent;
  while (parent && /^(TSAsExpression|TSSatisfiesExpression|TSNonNullExpression)$/.test(parent.type)) { child = parent; parent = parent.parent; }
  return { child, parent };
}
function label(node: AnyNode, source: SourceCode): string {
  if (node.type === 'SwitchStatement') return `switch(${text(node['discriminant'], source)})`;
  if (isNode(node['id'])) return `${node.type}:${text(node['id'], source)}`;
  const { child, parent } = expressionParent(node);
  if (parent?.type === 'VariableDeclarator') return `${node.type}:${text(parent['id'], source)}`;
  if (parent && ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent.type)) return `${node.type}:${text(parent['key'], source)}`;
  if (parent?.type === 'AssignmentExpression') return `${node.type}:${text(parent['left'], source)}`;
  if (parent?.type === 'CallExpression' || parent?.type === 'NewExpression') return callLabel(node, child, parent, source);
  if (parent?.type === 'ReturnStatement') return `${node.type}:return`;
  return node.type;
}
/** Names and lexical owners, never source lines or a hash of the changing body. */
export function identities(source: SourceCode): (node: Rule.Node, metric: string) => string {
  const names = new WeakMap<object, string>();
  const counts = new Map<string, number>();
  function visit(node: AnyNode): void {
    if (OWNERS.has(node.type) || node.type === 'SwitchStatement') {
      const scope = owner(node);
      const prefix = scope ? names.get(scope) ?? '$' : '$';
      const base = `${prefix}/${label(node, source)}`;
      const nth = (counts.get(base) ?? 0) + 1;
      counts.set(base, nth);
      names.set(node, `${base}#${nth}`);
    }
    for (const key of source.visitorKeys[node.type] ?? []) {
      const value = node[key];
      for (const child of Array.isArray(value) ? value : [value]) if (isNode(child)) visit(child);
    }
  }
  visit(source.ast as unknown as AnyNode);
  return (raw, metric) => {
    if (metric === 'max-lines' || metric === 'max-classes-per-file') return '$file';
    let node = normalize(raw as AnyNode);
    if (metric === 'max-depth') {
      while (!FUNCTIONS.has(node.type) && node.type !== 'StaticBlock' && node.parent) node = node.parent;
    }
    return names.get(node) ?? '$file';
  };
}
