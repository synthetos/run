// Lint configuration for synthetos/run (ROADMAP P0-02).
//
// The boundary and safety rules below are part of the safety case: a change
// to this file, or to tools/gates/src/eslint/, needs safety-path review
// (SAFETY §8). Each rule names the files it applies to; never widen an
// exception without a reviewed reason in the comment next to it.
import tseslint from 'typescript-eslint';
import run from './tools/gates/src/eslint/plugin.ts';
import { WEB_SERIAL_CHOOSER_MODULE, WEB_SERIAL_PROPERTY, WEB_SERIAL_TRANSPORT_MODULE } from './tools/gates/src/shared/webSerialNames.ts';

const ALL_SOURCE = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

/**
 * Machine-path packages that must never touch the network (SAFETY §8 item 22,
 * T-S57): the same six packages as SAFETY_PATH in .dependency-cruiser.cjs.
 * schema was missing until the P0 review (P0-02 #2): machine imports it, so a
 * schema helper calling fetch put the network one import away from machine.
 */
const NO_NETWORK = ['packages/{protocol,safety,machine,flasher,provenance,schema}/**'];

/** Runtime source: what ships, or runs on the machine path (not tests, not tools, not build config). */
const RUNTIME_SOURCE = ['{packages,apps,workers}/*/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

/**
 * The dev-only test kit installs its fake serial seam on the global object
 * (packages/testkit/src/marker.ts and the P0-14 fake-serial build). It never
 * reaches a production build: dependency-cruiser's entries-never-reach-testkit
 * and the bundle scan's testkit-marker rule refuse it. It is exempt from the
 * capability rule only; the dynamic-import rule still applies to it.
 */
const TESTKIT_SOURCE = 'packages/testkit/**';

/** The only module allowed to use HTML-parsing sinks: it owns the Trusted Types policies (P0-04). */
const TRUSTED_TYPES_MODULE = 'apps/web/src/security/tt.ts';

/** The single source of every W and C string (SAFETY §5, T-S32). */
const SAFETY_STRINGS_MODULE = 'packages/safety/src/strings.ts';

/**
 * The definition of the HTML-sink rule must name the sinks it bans. Only the
 * definition is exempt; its tests build their samples inside code strings.
 */
const HTML_SINK_RULE_DEFINITION = 'tools/gates/src/eslint/rules/noHtmlSink.ts';

/**
 * The Trusted Types E2E test must assign to an HTML sink to prove that the
 * browser refuses it under the production CSP (ROADMAP P0-04, T-S25). It runs
 * only in Playwright, never in the app.
 */
const TRUSTED_TYPES_E2E = 'tools/e2e/specs/trusted-types.e2e.ts';

/** Likewise, the Web Serial rule's definition names the methods it bans. */
const WEB_SERIAL_RULE_DEFINITION = 'tools/gates/src/eslint/rules/noWebSerial.ts';
// The list of Web Serial-only names that rule and the bundle scan share.
const WEB_SERIAL_NAMES = 'tools/gates/src/shared/webSerialNames.ts';

/**
 * The one module that may use Web Serial (ROADMAP P1-01). The owner approved
 * lifting the Phase 0 ban for this file only, in its own reviewed change
 * (P1-00). It is exempt from `run/no-web-serial`, and
 * `run/no-capability-lookup` admits a static `navigator.serial` read here and
 * nowhere else; every other capability form stays refused in it. Its tests
 * are NOT exempt.
 */
const WEB_SERIAL_TRANSPORT = WEB_SERIAL_TRANSPORT_MODULE;

/**
 * The window's port chooser (OD-3, owner-approved 2026-11-02, its own
 * reviewed change): the second and last module that may use Web Serial,
 * held to exactly the transport's terms. Its tests are not exempt either.
 */
const WEB_SERIAL_CHOOSER = WEB_SERIAL_CHOOSER_MODULE;

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-fake-serial/**',
      '**/dist-bench/**',
      '**/.wrangler/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  {
    // Inline `eslint-disable` / `eslint` comments are ignored everywhere, so a
    // safety rule can never be switched off from inside the file it guards.
    // An exception is made here, in this reviewed file, or not at all.
    linterOptions: { noInlineConfig: true },
  },
  ...tseslint.configs.recommended,
  {
    files: ALL_SOURCE,
    plugins: { run },
    rules: {
      // Code from strings is never evaluated.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Nothing reaches a serial port except the Web Serial transport (P1-00,
    // owner-approved; ROADMAP P1-01).
    files: ALL_SOURCE,
    ignores: [WEB_SERIAL_RULE_DEFINITION, WEB_SERIAL_NAMES, WEB_SERIAL_TRANSPORT, WEB_SERIAL_CHOOSER],
    rules: { 'run/no-web-serial': 'error' },
  },
  {
    files: ALL_SOURCE,
    ignores: [TRUSTED_TYPES_MODULE, HTML_SINK_RULE_DEFINITION, TRUSTED_TYPES_E2E],
    rules: { 'run/no-html-sink': 'error' },
  },
  {
    files: ALL_SOURCE,
    ignores: [SAFETY_STRINGS_MODULE],
    rules: { 'run/no-signal-word-literal': 'error' },
  },
  {
    // Every E2E test runs under the origin guard (ROADMAP P0-06): specs take
    // `test` from tools/e2e/specs/fixtures.ts, which installs it, never
    // straight from Playwright. Types may still come from @playwright/test.
    files: ['tools/e2e/specs/**'],
    ignores: ['tools/e2e/specs/fixtures.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              importNames: ['test', 'expect', 'chromium', 'firefox', 'webkit', 'devices', '_baseTest'],
              message: "Import test and expect from './fixtures.ts' so the origin guard runs (ROADMAP P0-06).",
            },
          ],
        },
      ],
    },
  },
  {
    files: NO_NETWORK,
    rules: { 'run/no-network-api': 'error' },
  },
  {
    // P0 review (P0-13): navigator and the window aliases only in static,
    // reviewed forms; no Reflect. See tools/gates/src/shared/capabilities.ts.
    files: RUNTIME_SOURCE,
    ignores: [TESTKIT_SOURCE],
    rules: { 'run/no-capability-lookup': 'error' },
  },
  {
    // P1-00: the static read `navigator.serial` is admitted in the Web Serial
    // transport and (OD-3) the window's port chooser only. This block must
    // stay after the one above (flat config: the later setting wins for a
    // file both match).
    files: [WEB_SERIAL_TRANSPORT, WEB_SERIAL_CHOOSER],
    rules: { 'run/no-capability-lookup': ['error', { navigatorProperties: [WEB_SERIAL_PROPERTY] }] },
  },
  {
    // P0 review (P0-14): every import edge is one dependency-cruiser can see.
    files: RUNTIME_SOURCE,
    rules: { 'run/no-dynamic-import': 'error' },
  },
  {
    files: ['packages/machine/**'],
    rules: { 'run/no-writer-abort': 'error' },
  },
  {
    // Determinism on the safety path: no unseeded randomness in decisions,
    // plans or protocol handling.
    files: ['packages/{safety,protocol}/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Math.random is banned in safety and protocol: their behaviour must be deterministic and testable.',
        },
      ],
    },
  },
);
