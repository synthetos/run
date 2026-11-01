import type { Rule } from 'eslint';
import { type AnyNode, staticName, stringValue } from '../ast.ts';

/** What a banned-name rule needs to know. */
export interface BannedNamesSpec {
  /** One-line rule description for the docs. */
  readonly description: string;
  /** The names that may not appear. Matched exactly and case-sensitively. */
  readonly names: readonly string[];
  /** The report message. `{{name}}` is replaced by the offending name. */
  readonly message: string;
}

/**
 * Builds a rule that bans a set of names wherever they appear as a name in
 * the source: as an identifier (a reference, a declaration, a member
 * property, an object key, a destructured binding, a type reference, an
 * import or export specifier), as a JSX attribute or tag name, or as a
 * string or template literal whose whole text is the name (which covers
 * `obj['name']`, `Reflect.get(obj, 'name')` and `'name' in obj`).
 *
 * It is deliberately broad: it cannot be bypassed by renaming the object or
 * by bracket access, and a false positive costs a rename, while a false
 * negative on the machine path costs a safety review. The bundle scan
 * (P0-13) backs it up on the built output.
 */
export function bannedNamesRule(spec: BannedNamesSpec): Rule.RuleModule {
  const banned = new Set(spec.names);
  return {
    meta: {
      type: 'problem',
      docs: { description: spec.description },
      schema: [],
      messages: { banned: spec.message },
    },
    create(context) {
      // A shorthand property (`{ abort }`) has distinct key and value nodes
      // over the same source range; report each range once.
      const reported = new Set<string>();
      const report = (node: AnyNode, name: string): void => {
        const range = (node as { range?: readonly [number, number] }).range;
        const key = range === undefined ? undefined : `${range[0]}:${range[1]}`;
        if (key !== undefined) {
          if (reported.has(key)) return;
          reported.add(key);
        }
        context.report({ node: node as unknown as Rule.Node, messageId: 'banned', data: { name } });
      };
      const checkName = (node: AnyNode, name: unknown): void => {
        if (typeof name === 'string' && banned.has(name)) report(node, name);
      };
      const checkWholeString = (node: AnyNode): void => {
        const text = stringValue(node);
        if (text !== undefined && banned.has(text)) report(node, text);
      };
      return {
        Identifier: (node: Rule.Node) => checkName(node as unknown as AnyNode, (node as { name: string }).name),
        JSXIdentifier: (node: Rule.Node) => checkName(node as unknown as AnyNode, (node as unknown as AnyNode)['name']),
        Literal: (node: Rule.Node) => checkWholeString(node as unknown as AnyNode),
        TemplateLiteral: (node: Rule.Node) => {
          const n = node as unknown as AnyNode;
          const name = staticName(n, true);
          if (name !== undefined && banned.has(name)) report(n, name);
        },
      };
    },
  };
}
