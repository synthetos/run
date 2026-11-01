// Lint configuration for synthetos/run (ROADMAP P0-02).
//
// The boundary and safety rules below are part of the safety case: a change
// to this file, or to tools/gates/src/eslint/, needs safety-path review
// (SAFETY §8). Each rule names the files it applies to; never widen an
// exception without a reviewed reason in the comment next to it.
import tseslint from 'typescript-eslint';
import run from './tools/gates/src/eslint/plugin.ts';

const ALL_SOURCE = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

/** Machine-path packages that must never touch the network (SAFETY §8 item 22, T-S57). */
const NO_NETWORK = ['packages/{protocol,safety,machine,flasher,provenance}/**'];

/** The only module allowed to use HTML-parsing sinks: it owns the Trusted Types policies (P0-04). */
const TRUSTED_TYPES_MODULE = 'apps/web/src/security/tt.ts';

/** The single source of every W and C string (SAFETY §5, T-S32). */
const SAFETY_STRINGS_MODULE = 'packages/safety/src/strings.ts';

/**
 * The definition of the HTML-sink rule must name the sinks it bans. Only the
 * definition is exempt; its tests build their samples inside code strings.
 */
const HTML_SINK_RULE_DEFINITION = 'tools/gates/src/eslint/rules/noHtmlSink.ts';

/** Likewise, the Web Serial rule's definition names the methods it bans. */
const WEB_SERIAL_RULE_DEFINITION = 'tools/gates/src/eslint/rules/noWebSerial.ts';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
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
    // Phase 0 cannot reach a serial port. P1-01 narrows this to
    // packages/machine/src/webSerialTransport.ts in its own owner-approved PR.
    files: ALL_SOURCE,
    ignores: [WEB_SERIAL_RULE_DEFINITION],
    rules: { 'run/no-web-serial': 'error' },
  },
  {
    files: ALL_SOURCE,
    ignores: [TRUSTED_TYPES_MODULE, HTML_SINK_RULE_DEFINITION],
    rules: { 'run/no-html-sink': 'error' },
  },
  {
    files: ALL_SOURCE,
    ignores: [SAFETY_STRINGS_MODULE],
    rules: { 'run/no-signal-word-literal': 'error' },
  },
  {
    files: NO_NETWORK,
    rules: { 'run/no-network-api': 'error' },
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
