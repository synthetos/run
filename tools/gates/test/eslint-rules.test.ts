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

// P0 review fix pass (P0-13): Web Serial must not be reachable through a
// computed or reflective lookup. Navigator is admitted only as a read of a
// reviewed data property; window aliases only with a static key.
tester.run('run/no-capability-lookup', rule('no-capability-lookup'), {
  valid: [
    'const lang = navigator.language;',
    'const ua = globalThis.navigator.userAgent;',
    'const online = self.navigator.onLine;',
    "const has = typeof navigator !== 'undefined';",
    'const o = globalThis.location.origin;',
    "const tt = (globalThis as { trustedTypes?: unknown })['trustedTypes'];",
    'const tt2 = globalThis[`trustedTypes`];',
    "const ok = 'trustedTypes' in globalThis;",
    "globalThis.addEventListener('message', () => {});",
    "const w = typeof window === 'undefined';",
    // Local bindings that share a window alias name are not the global.
    'function f(top: number, parent: number) { return [top, parent][0]; }',
    'const self = { a: 1 }; const k = "a"; const v = self[k as "a"];',
    'const { a } = obj; const b = rect.top;',
  ],
  invalid: [
    // The reviewer probe, verbatim: navigator passed to Reflect.get, and Reflect itself (three uses).
    {
      code: "const s = Reflect.get(navigator, ['ser', 'ial'].join(''));\nvoid Reflect.apply(Reflect.get(s, ['get', 'Ports'].join('')), s, []);",
      errors: [
        { messageId: 'reflect' },
        { messageId: 'navigator' },
        { messageId: 'reflect' },
        { messageId: 'reflect' },
      ],
    },
    { code: "const s = navigator['ser' + 'ial'];", errors: [{ messageId: 'navigator' }] },
    { code: 'const s = navigator[key];', errors: [{ messageId: 'navigator' }] },
    { code: 'const s = navigator.serialize;', errors: [{ messageId: 'navigator' }] },
    { code: 'const n = navigator;', errors: [{ messageId: 'navigator' }] },
    { code: 'use(navigator);', errors: [{ messageId: 'navigator' }] },
    { code: 'const k = Object.keys(navigator);', errors: [{ messageId: 'navigator' }] },
    { code: "const has = 'serial' in navigator;", errors: [{ messageId: 'navigator' }] },
    { code: 'const n = globalThis.navigator;', errors: [{ messageId: 'navigator' }] },
    { code: "const n = globalThis['navigator'][k];", errors: [{ messageId: 'navigator' }] },
    { code: "const n = (globalThis as any)['navi' + 'gator'];", errors: [{ messageId: 'global' }] },
    { code: 'const v = window[name];', errors: [{ messageId: 'global' }] },
    { code: 'const v = self?.[name];', errors: [{ messageId: 'global' }] },
    { code: 'const g = globalThis;', errors: [{ messageId: 'global' }] },
    { code: 'const { location } = window;', errors: [{ messageId: 'global' }] },
    { code: 'const v = top[k];', errors: [{ messageId: 'global' }] },
    { code: 'const v = parent.frames[k];', errors: [{ messageId: 'global' }] },
    { code: 'const w = document.defaultView;', errors: [{ messageId: 'global' }] },
    { code: 'const v = frame.contentWindow[k];', errors: [{ messageId: 'global' }] },
    { code: "const n = Reflect.get(globalThis, 'navigator');", errors: [{ messageId: 'reflect' }, { messageId: 'global' }, { messageId: 'navigator' }] },
    { code: "const n = 'navigator';", errors: [{ messageId: 'navigator' }] },
    { code: 'const { navigator: n } = globalThis;', errors: [{ messageId: 'navigator' }, { messageId: 'global' }] },
    { code: 'const c = clientInformation[k];', errors: [{ messageId: 'navigator' }] },
    // An ambient declaration does not create a runtime binding: it is still the global.
    { code: 'declare const navigator: any; const v = navigator[k];', errors: [{ messageId: 'navigator' }] },
    { code: 'declare const window: any; const v = window[k];', errors: [{ messageId: 'global' }] },
    { code: 'const R = Reflect;', errors: [{ messageId: 'reflect' }] },
  ],
});

// P1-00: the Web Serial transport (and only it, eslint.config.js) gets
// `navigatorProperties: ['serial']`. The option admits the static read and
// nothing else: every other capability form stays refused in that file.
const SERIAL_OPTION = [{ navigatorProperties: ['serial'] }];
tester.run('run/no-capability-lookup with navigatorProperties (P1-00)', rule('no-capability-lookup'), {
  valid: [
    { code: 'const serial = navigator.serial;', options: SERIAL_OPTION },
    { code: "const serial = navigator['serial'];", options: SERIAL_OPTION },
    { code: 'const ports = () => navigator.serial.getPorts();', options: SERIAL_OPTION },
    { code: 'const lang = navigator.language;', options: SERIAL_OPTION },
  ],
  invalid: [
    // Without the option, the same read is refused (the default for every other file).
    { code: 'const serial = navigator.serial;', errors: [{ messageId: 'navigator' }] },
    { code: "const s = navigator['ser' + 'ial'];", options: SERIAL_OPTION, errors: [{ messageId: 'navigator' }] },
    { code: 'const s = navigator[key];', options: SERIAL_OPTION, errors: [{ messageId: 'navigator' }] },
    { code: 'const n = navigator; const s = n.serial;', options: SERIAL_OPTION, errors: [{ messageId: 'navigator' }] },
    { code: "const has = 'serial' in navigator;", options: SERIAL_OPTION, errors: [{ messageId: 'navigator' }] },
    { code: 'const usb = navigator.usb;', options: SERIAL_OPTION, errors: [{ messageId: 'navigator' }] },
    { code: "const s = Reflect.get(navigator, 'serial');", options: SERIAL_OPTION, errors: [{ messageId: 'reflect' }, { messageId: 'navigator' }] },
    { code: 'const { serial } = navigator;', options: SERIAL_OPTION, errors: [{ messageId: 'navigator' }] },
  ],
});

// P0 review fix pass (P0-14): an import whose specifier is computed at run
// time is an edge no dependency rule can check.
tester.run('run/no-dynamic-import', rule('no-dynamic-import'), {
  valid: ["const m = import('./a.ts');", 'const m = import(`./a.ts`);', "const m = import('./a.json', { with: { type: 'json' } });"],
  invalid: [
    { code: 'const load = (path: string) => import(/* @vite-ignore */ path);', errors: [{ messageId: 'dynamic' }] },
    { code: 'const load = (n: string) => import(`./${n}.ts`);', errors: [{ messageId: 'dynamic' }] },
    { code: "const load = (n: string) => import('./' + n);", errors: [{ messageId: 'dynamic' }] },
  ],
});
