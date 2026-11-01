import { bannedNamesRule } from './bannedNames.ts';

/**
 * HTML-parsing sinks. They are allowed only in `apps/web/src/security/tt.ts`,
 * which owns the Trusted Types policies (ROADMAP P0-02, P0-04). Preact's
 * `dangerouslySetInnerHTML` is the same sink reached through a component.
 */
export const HTML_SINKS: readonly string[] = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'dangerouslySetInnerHTML'];

export const noHtmlSink = bannedNamesRule({
  description: 'Ban HTML-parsing sinks outside apps/web/src/security/tt.ts.',
  names: HTML_SINKS,
  message:
    "'{{name}}' parses HTML and is allowed only in apps/web/src/security/tt.ts (Trusted Types policies). " +
    'Build DOM nodes or render with Preact instead.',
});
