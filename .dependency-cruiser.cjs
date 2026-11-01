// Boundary gate for synthetos/run (ROADMAP P0-02, RUN_PLAN §5.3, SAFETY §8
// items 22 and 31, T-S40, T-S57).
//
// Every rule is an error. Run with `pnpm deps`. A change to this file is a
// change to the safety boundary and needs safety-path review (SAFETY §8).
//
// Paths are matched against module paths relative to the repository root, as
// dependency-cruiser resolves them (symlinks followed, so a workspace package
// import resolves to `packages/<name>/src/...`).

/** Packages on the machine path (safety-critical): no npm, no network, no cloud. */
const SAFETY_PATH = '(protocol|safety|machine|flasher|provenance|schema)';
/** Runtime (non-test) source of the safety-path packages. */
const SAFETY_PATH_SRC = `^packages/${SAFETY_PATH}/src/`;
/** The cloud client: the only network code in the web app (RUN_PLAN §5.3). */
const CLOUD = '^apps/web/src/cloud/';
/** Anything that resolves into an installed npm package. */
const NPM = '(^|/)node_modules/';
/** The dev-only test kit, by path or through its workspace link. */
const TESTKIT = '(^packages/testkit/|(^|/)node_modules/@synthetos/testkit/)';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // --- Safety path: zero runtime npm dependencies (RUN_PLAN §5.3) -------
    {
      name: 'safety-path-no-npm',
      comment:
        'protocol, safety, machine, flasher, provenance and schema have ZERO runtime npm dependencies ' +
        '(RUN_PLAN §5.3). This also covers npm code reached through another workspace package.',
      severity: 'error',
      from: { path: SAFETY_PATH_SRC },
      to: { path: NPM, reachable: true },
    },
    {
      name: 'safety-path-no-node-core',
      comment: 'Safety-path packages run in the browser worker; Node built-ins are never available there.',
      severity: 'error',
      from: { path: SAFETY_PATH_SRC },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'safety-path-no-contracts-or-cloud',
      comment:
        'The machine path never imports contracts or the cloud client (RUN_PLAN §5.3, SAFETY §8 item 22): ' +
        'the network is never in the motion or stop path (SAFETY §4.10).',
      severity: 'error',
      from: { path: `^packages/${SAFETY_PATH}/` },
      to: { path: `(^packages/contracts/|(^|/)node_modules/@synthetos/contracts/|${CLOUD})` },
    },
    {
      name: 'safety-path-no-apps-or-workers',
      comment: 'Packages never import applications or Workers (dependencies point inwards only).',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^(apps|workers)/' },
    },

    // --- Cloud client (RUN_PLAN §5.3) ------------------------------------
    {
      name: 'cloud-imports-only-contracts-and-provenance',
      comment:
        'apps/web/src/cloud may import contracts and provenance only. It never imports machine, protocol, ' +
        'safety or any other machine-path package (RUN_PLAN §5.3). Cloud data reaches the machine only ' +
        'through the UI-layer job loader and profile-diff modules.',
      severity: 'error',
      from: { path: CLOUD },
      to: {
        path: '(^packages/|(^|/)node_modules/@synthetos/)',
        pathNot: '(^packages/(contracts|provenance)/|(^|/)node_modules/@synthetos/(contracts|provenance)/)',
      },
    },

    // --- run Worker (RUN_PLAN §5.2, §5.3, T-S57) -------------------------
    {
      name: 'worker-imports-only-contracts',
      comment:
        'workers/run imports contracts only (auth-core joins in A1). The server holds no machine logic, ' +
        'so it cannot be trusted for safety (RUN_PLAN §5.3, T-S57).',
      severity: 'error',
      from: { path: '^workers/run/src/' },
      to: {
        path: `(^packages/|^apps/|^tools/|${NPM})`,
        pathNot: '(^packages/contracts/|(^|/)node_modules/@synthetos/contracts/)',
      },
    },

    // --- Test kit is dev only (RUN_PLAN §5.3, SAFETY §8 item 31, T-S40) ---
    {
      name: 'entries-never-reach-testkit',
      comment:
        'No production entry graph may reach @synthetos/testkit, directly or transitively ' +
        '(RUN_PLAN §5.3, SAFETY §8 item 31, T-S40).',
      severity: 'error',
      from: { path: '^apps/web/src/entries/' },
      to: { path: TESTKIT, reachable: true },
    },
    {
      name: 'production-source-never-imports-testkit',
      comment:
        'Only tests may import the test kit. Production source (any src/ outside the test kit) never does.',
      severity: 'error',
      from: { path: '^(packages|apps|workers)/[^/]+/src/', pathNot: '^packages/testkit/' },
      to: { path: TESTKIT },
    },

    {
      name: 'production-source-never-imports-tools',
      comment: 'tools/ holds dev-only repository gates. No package, app or Worker source imports it.',
      severity: 'error',
      from: { path: '^(packages|apps|workers)/' },
      to: { path: '^tools/' },
    },

    // --- Repository hygiene ----------------------------------------------
    {
      name: 'no-import-outside-repo',
      comment:
        'Nothing imports from outside this repository, in particular never the synthetos.com site ' +
        '(RUN_PLAN §5.3). Design tokens are copied and drift-tested instead.',
      severity: 'error',
      from: {},
      to: { path: '^\\.\\./', dependencyTypesNot: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'] },
    },
    {
      name: 'no-unresolvable',
      comment: 'Every import must resolve. An unresolved import cannot be checked against the rules above.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-undeclared-npm',
      comment: 'An npm import must be declared in the package.json of the importing workspace package (or the root).',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
  ],

  options: {
    doNotFollow: { path: NPM },
    // Build output and reports inside this repository only. The pattern is
    // anchored to the workspace roots on purpose: a loose `/dist/` would also
    // match inside node_modules and silently drop the dependency on any
    // package whose entry lives in its own `dist/` (vitest, for example).
    exclude: {
      path: [
        '^(dist|coverage|test-results|playwright-report)/',
        '^(packages|apps|workers|tools)/[^/]+/(dist|coverage|\\.wrangler|test-results|playwright-report)/',
      ],
    },
    // Detect type-only imports too: a type import of an npm package from the
    // safety path is still a dependency on it.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    moduleSystems: ['es6', 'cjs'],
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.d.ts'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
