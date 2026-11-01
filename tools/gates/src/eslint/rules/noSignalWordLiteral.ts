import type { Rule } from 'eslint';
import { type AnyNode, stringValue } from '../ast.ts';

/**
 * A signal word followed by a space and an em dash (U+2014), the form every
 * W and C string in SAFETY §5–§6 starts with. Written with an escape so this
 * file does not itself contain the banned text.
 */
export const SIGNAL_WORD_PATTERN = /\b(WARNING|DANGER|NOTICE) \u2014/u;

/**
 * Bans signal-word strings outside `packages/safety/src/strings.ts`, the
 * single source of every warning and confirmation string (SAFETY §5, T-S32).
 * Checks string literals, template quasis and JSX text.
 */
export const noSignalWordLiteral: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Ban WARNING/DANGER/NOTICE strings outside packages/safety/src/strings.ts.' },
    schema: [],
    messages: {
      banned:
        "'{{word}} —' strings live only in packages/safety/src/strings.ts (SAFETY §5, T-S32). " +
        'Import the string function from @synthetos/safety instead of writing the text here.',
    },
  },
  create(context) {
    const check = (node: Rule.Node): void => {
      const text = stringValue(node as unknown as AnyNode);
      const match = text === undefined ? null : SIGNAL_WORD_PATTERN.exec(text);
      if (match !== null) context.report({ node, messageId: 'banned', data: { word: match[1] ?? '' } });
    };
    return { Literal: check, TemplateElement: check, JSXText: check };
  },
};
