import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import plugin from '../src/eslint/plugin.ts';
import { HTML_SINKS } from '../src/eslint/rules/noHtmlSink.ts';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

function rule(name: string) {
  const found = plugin.rules?.[name];
  if (found === undefined) throw new Error(`rule ${name} is not registered in the run plugin`);
  return found as Parameters<RuleTester['run']>[1];
}

const tsx = (code: string) => ({ code, filename: 'component.tsx' });

tester.run('run/no-network-api', rule('no-network-api'), {
  valid: [
    'const data = parse(bytes);',
    'const fetched = 1; const prefetch = 2;',
    "const s = 'fetch the tool';",
  ],
  invalid: [
    { code: 'fetch("/api/x");', errors: [{ messageId: 'banned', data: { name: 'fetch' } }] },
    { code: 'globalThis.fetch("/x");', errors: [{ messageId: 'banned' }] },
    { code: "self['fetch']('/x');", errors: [{ messageId: 'banned' }] },
    { code: 'self[`fetch`]("/x");', errors: [{ messageId: 'banned' }] },
    { code: 'const { fetch: f } = globalThis;', errors: [{ messageId: 'banned' }] },
    { code: 'new XMLHttpRequest();', errors: [{ messageId: 'banned' }] },
    { code: 'new WebSocket("wss://x");', errors: [{ messageId: 'banned' }] },
    { code: 'new EventSource("/x");', errors: [{ messageId: 'banned' }] },
    { code: 'importScripts("x.js");', errors: [{ messageId: 'banned' }] },
    { code: 'navigator.sendBeacon("/x", b);', errors: [{ messageId: 'banned' }] },
    { code: "Reflect.get(globalThis, 'WebSocket');", errors: [{ messageId: 'banned' }] },
    { code: 'let s: WebSocket | undefined;', errors: [{ messageId: 'banned' }] },
  ],
});

tester.run('run/no-html-sink', rule('no-html-sink'), {
  valid: [
    'el.textContent = text;',
    'el.append(document.createTextNode(text));',
    tsx('const C = () => <div>{text}</div>;'),
  ],
  invalid: [
    { code: 'el.innerHTML = html;', errors: [{ messageId: 'banned', data: { name: HTML_SINKS[0] } }] },
    { code: 'el.outerHTML = html;', errors: [{ messageId: 'banned' }] },
    { code: "el.insertAdjacentHTML('beforeend', html);", errors: [{ messageId: 'banned' }] },
    { code: "el['innerHTML'] = html;", errors: [{ messageId: 'banned' }] },
    { code: 'const { innerHTML } = el;', errors: [{ messageId: 'banned' }] },
    { ...tsx('const C = () => <div dangerouslySetInnerHTML={{ __html: html }} />;'), errors: [{ messageId: 'banned' }] },
    { code: "h('div', { dangerouslySetInnerHTML: { __html: html } });", errors: [{ messageId: 'banned' }] },
    {
      ...tsx('export function Panel() { const r = useRef(null); r.current.innerHTML = x; return <div ref={r} />; }'),
      errors: [{ messageId: 'banned' }],
    },
  ],
});

tester.run('run/no-writer-abort', rule('no-writer-abort'), {
  valid: ['await writer.write(line);', 'await writer.close();', 'const s = AbortSignal.timeout(250);', 'if (signal.aborted) return;'],
  invalid: [
    { code: 'await writer.abort();', errors: [{ messageId: 'banned', data: { name: 'abort' } }] },
    { code: 'port.writable.abort(reason);', errors: [{ messageId: 'banned' }] },
    { code: "writer['abort']();", errors: [{ messageId: 'banned' }] },
    { code: 'const { abort } = writer;', errors: [{ messageId: 'banned' }] },
    { code: 'controller.abort();', errors: [{ messageId: 'banned' }] },
  ],
});

tester.run('run/no-web-serial', rule('no-web-serial'), {
  valid: [
    'const n = board.serial;',
    'const ua = navigator.userAgent;',
    "const t = 'serial';",
    "const has = 'usb' in navigator;",
    'const { userAgent } = navigator;',
    "Reflect.get(navigator, 'userAgent');",
    'const portName = requestPortLabel;',
  ],
  invalid: [
    // The member access and the Web Serial-only method name are each reported.
    { code: 'navigator.serial.requestPort();', errors: [{ messageId: 'banned' }, { messageId: 'banned' }] },
    { code: 'await navigator.serial.getPorts();', errors: [{ messageId: 'banned' }, { messageId: 'banned' }] },
    { code: 'globalThis.navigator.serial;', errors: [{ messageId: 'banned' }] },
    { code: "self.navigator['serial'];", errors: [{ messageId: 'banned' }] },
    { code: 'window.navigator?.serial;', errors: [{ messageId: 'banned' }] },
    { code: 'navigator?.serial;', errors: [{ messageId: 'banned' }] },
    { code: '(navigator as any).serial;', errors: [{ messageId: 'banned' }] },
    { code: 'const { serial } = navigator;', errors: [{ messageId: 'banned' }] },
    { code: 'let s; ({ serial: s } = navigator);', errors: [{ messageId: 'banned' }] },
    { code: 'function f({ serial } = navigator) { return serial; }', errors: [{ messageId: 'banned' }] },
    { code: "if ('serial' in navigator) {}", errors: [{ messageId: 'banned' }] },
    { code: "Reflect.get(navigator, 'serial');", errors: [{ messageId: 'banned' }] },
    { code: 'Reflect.get(globalThis.navigator, `serial`);', errors: [{ messageId: 'banned' }] },
    // Through an alias the navigator is not visible, but the method names are.
    { code: 'const n = navigator; n.serial.requestPort();', errors: [{ messageId: 'banned' }] },
    { code: 'export const ports = (s: { getPorts(): Promise<unknown[]> }) => s.getPorts();', errors: [{ messageId: 'banned' }, { messageId: 'banned' }] },
    { code: "serialApi['requestPort']();", errors: [{ messageId: 'banned' }] },
    { code: 'const { requestPort } = api;', errors: [{ messageId: 'banned' }] },
  ],
});

// The banned text is assembled at run time so this file never contains it.
const EM = '—';
const W1 = `WARNING ${EM} This software is not an emergency stop.`;

tester.run('run/no-signal-word-literal', rule('no-signal-word-literal'), {
  valid: [
    "const s = 'Warning: low disk';",
    "const s = 'WARNING - plain hyphen';",
    `const s = 'FOREWARNING ${EM} not a signal word';`,
    'const s = warningW1();',
  ],
  invalid: [
    { code: `const s = '${W1}';`, errors: [{ messageId: 'banned', data: { word: 'WARNING' } }] },
    { code: `const s = 'DANGER ${EM} x';`, errors: [{ messageId: 'banned', data: { word: 'DANGER' } }] },
    { code: `const s = \`NOTICE ${EM} \${n} s\`;`, errors: [{ messageId: 'banned', data: { word: 'NOTICE' } }] },
    { ...tsx(`const C = () => <p>${W1}</p>;`), errors: [{ messageId: 'banned' }] },
  ],
});
