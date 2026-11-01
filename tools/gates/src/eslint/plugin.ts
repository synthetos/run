/**
 * `run`: the repository's own ESLint rules (ROADMAP P0-02). Wired up, with
 * the files each rule applies to, in the root `eslint.config.js`.
 */
import type { ESLint } from 'eslint';
import { noCapabilityLookup } from './rules/noCapabilityLookup.ts';
import { noDynamicImport } from './rules/noDynamicImport.ts';
import { noHtmlSink } from './rules/noHtmlSink.ts';
import { noNetworkApi } from './rules/noNetworkApi.ts';
import { noSignalWordLiteral } from './rules/noSignalWordLiteral.ts';
import { noWebSerial } from './rules/noWebSerial.ts';
import { noWriterAbort } from './rules/noWriterAbort.ts';

const plugin: ESLint.Plugin = {
  meta: { name: 'run', version: '0.0.0' },
  rules: {
    'no-network-api': noNetworkApi,
    'no-html-sink': noHtmlSink,
    'no-writer-abort': noWriterAbort,
    'no-web-serial': noWebSerial,
    'no-signal-word-literal': noSignalWordLiteral,
    'no-capability-lookup': noCapabilityLookup,
    'no-dynamic-import': noDynamicImport,
  },
};

export default plugin;
