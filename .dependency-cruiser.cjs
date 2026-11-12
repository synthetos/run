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
/**
 * The machining assistant's pure packages (MACHINING_ASSISTANT §9: "no
 * network, no machine import"). They are not on the machine path, but every
 * engine's suggestion passes through advisor's envelope before it can reach
 * an actuator, so they are held to the machine path's purity rules.
 */
const ASSISTANT = '(library|advisor)';
/** Runtime (non-test) source of the assistant packages. */
const ASSISTANT_SRC = `^packages/${ASSISTANT}/src/`;
/**
 * What the assistant packages may never reach, by path or workspace link:
 * the machine path (machine, protocol and its transports, safety, flasher),
 * contracts, the other app-facing packages, the test kit, every app (the
 * cloud client included) and Worker, and all of schema except its
 * dependency-free JSON Schema validator.
 */
const ASSISTANT_FORBIDDEN_REACH =
  '(^packages/(machine|protocol|safety|flasher|contracts|testkit|gcode|gcode-view|wiring|provenance)/' +
  '|(^|/)node_modules/@synthetos/(machine|protocol|safety|flasher|contracts|testkit|gcode|gcode-view|wiring|provenance)/' +
  '|^packages/schema/(?!src/jsonSchema\\.ts$)|(^|/)node_modules/@synthetos/schema/(?!src/jsonSchema\\.ts$)' +
  '|^apps/|^workers/)';

/**
 * One layering rule (RUN_PLAN §5.3): runtime source of `pkg` may import its
 * own package and the listed workspace targets only. A target is a package
 * name, or `name/src/file.ts` for a single module (the flasher entry).
 */
function layer(pkg, allowed, why) {
  // Each target by path and through its workspace link (symlinks are followed, but a link path must not slip through).
  const forms = (a) => {
    const [name, ...rest] = a.split('/');
    const tail = rest.length === 0 ? '/' : `/${rest.join('/').replace(/\./g, '\\.')}$`;
    return [`^packages/${name}${tail}`, `(^|/)node_modules/@synthetos/${name}${tail}`];
  };
  const own = forms(pkg).join('|');
  const ok = allowed.flatMap(forms);
  return {
    name: `layer-${pkg}`,
    comment: `${why} (RUN_PLAN §5.3: apps/web -> {machine, gcode, flasher, wiring, schema, provenance, contracts} -> {safety, protocol} -> nothing).`,
    severity: 'error',
    from: { path: `^packages/${pkg}/src/` },
    to: {
      path: '(^packages/[^/]+/|(^|/)node_modules/@synthetos/)',
      pathNot: `(${[own, ...ok].join('|')})`,
    },
  };
}

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // --- Package layering (RUN_PLAN §5.3) --------------------------------
    layer('protocol', [], 'protocol is the bottom layer: it imports no other workspace package'),
    layer('safety', ['protocol'], 'safety imports protocol only'),
    layer('schema', ['protocol', 'safety'], 'schema imports protocol and safety only'),
    layer('machine', ['protocol', 'safety', 'schema', 'flasher/src/index.ts'], 'machine imports protocol, safety, schema and the flasher entry only'),
    layer('flasher', ['protocol'], 'flasher imports protocol only'),
    layer('gcode', ['protocol', 'safety'], 'gcode imports safety and protocol only'),
    layer('wiring', ['protocol', 'safety'], 'wiring imports safety and protocol only'),
    layer('provenance', ['protocol', 'safety'], 'provenance imports safety and protocol only'),
    layer('contracts', [], 'contracts depends only on valibot: it imports no workspace package'),
    layer('testkit', ['protocol', 'flasher'], 'the test kit may import protocol and flasher only'),
    layer('gcode-view', [], 'gcode-view is a publishable viewer whose input is a plain segment list: it imports no workspace package (never machine, safety, protocol or gcode)'),
    layer('library', ['schema/src/jsonSchema.ts'], "library imports only schema's dependency-free JSON Schema validator: never machine, protocol, contracts or the cloud client (MACHINING_ASSISTANT §9)"),
    layer('advisor', ['library', 'schema/src/jsonSchema.ts'], "advisor imports library and schema's JSON Schema validator only: never machine, protocol, contracts or the cloud client (MACHINING_ASSISTANT §9)"),
    {
      name: 'gcode-view-no-npm-or-node',
      comment: 'gcode-view is published on its own with zero runtime dependencies: no npm package and no Node built-in in its source (ROADMAP TB-03).',
      severity: 'error',
      from: { path: '^packages/gcode-view/src/' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown', 'core'] },
    },
    {
      name: 'no-circular',
      comment: 'No import cycle among or within the workspace packages: layering is a direction, and a cycle has none.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { circular: true },
    },

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

    // --- Machining assistant: pure, no network, no machine (MACHINING_ASSISTANT §9) ---
    {
      name: 'assistant-no-npm',
      comment:
        'library and advisor have ZERO runtime npm dependencies, direct or reached through another workspace ' +
        'package (MACHINING_ASSISTANT §9). Their validation uses the repository\'s own JSON Schema validator.',
      severity: 'error',
      from: { path: ASSISTANT_SRC },
      to: { path: NPM, reachable: true },
    },
    {
      name: 'assistant-no-node-core',
      comment: 'library and advisor run in the browser: Node built-ins are never available there.',
      severity: 'error',
      from: { path: ASSISTANT_SRC },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'assistant-never-reaches-machine-path',
      comment:
        'No chain of imports from library or advisor reaches machine, protocol, safety, flasher, contracts, the ' +
        'other app-facing packages, the test kit, any app (the cloud client included), a Worker, or any part of ' +
        'schema but its JSON Schema validator (MACHINING_ASSISTANT §1 principle 2, §9): advice never talks to the ' +
        'board or the network.',
      severity: 'error',
      from: { path: ASSISTANT_SRC },
      to: { path: ASSISTANT_FORBIDDEN_REACH, reachable: true },
    },

    // --- Cloud client (RUN_PLAN §5.3) ------------------------------------
    //
    // Two rules, because a rule on direct edges alone let cloud -> a web-app
    // helper -> machine pass (P0 review, P0-02 #1):
    //
    // 1. On every direct edge, the cloud client may import only its own
    //    modules, contracts, provenance and npm packages. Its closure is
    //    therefore cloud + contracts (which imports no workspace package) +
    //    provenance and what provenance's layer rule allows it (protocol and
    //    safety: the narrow provenance exception) + npm.
    // 2. Independently of rule 1, nothing in the cloud client may REACH,
    //    through any chain of imports, the machine-path packages outside that
    //    exception, the test kit, any other web-app module, a Worker or the
    //    dev tools.
    {
      name: 'cloud-imports-only-contracts-and-provenance',
      comment:
        'apps/web/src/cloud may import its own modules, contracts and provenance only. It never imports machine, ' +
        'protocol, safety, any other machine-path package, or any other web-app module (RUN_PLAN §5.3). Cloud data ' +
        'reaches the machine only through the UI-layer job loader and profile-diff modules, which import cloud, ' +
        'never the other way round.',
      severity: 'error',
      from: { path: CLOUD },
      to: {
        path: '(^packages/|(^|/)node_modules/@synthetos/|^apps/|^workers/|^tools/)',
        pathNot: `(^packages/(contracts|provenance)/|(^|/)node_modules/@synthetos/(contracts|provenance)/|${CLOUD})`,
      },
    },
    {
      name: 'cloud-never-reaches-machine-path',
      comment:
        'No chain of imports from apps/web/src/cloud reaches machine, flasher, schema, gcode, wiring, the test kit, ' +
        'another web-app module, a Worker or tools (RUN_PLAN §5.3, SAFETY §4.10, §8 item 22). protocol and safety ' +
        'are reachable only through provenance (the provenance exception), which the direct-edge rule above enforces.',
      severity: 'error',
      from: { path: CLOUD },
      to: {
        path:
          '(^packages/(machine|flasher|schema|gcode|wiring|testkit)/|(^|/)node_modules/@synthetos/(machine|flasher|schema|gcode|wiring|testkit)/' +
          '|^apps/(?!web/src/cloud/)|^workers/|^tools/)',
        reachable: true,
      },
    },

    // --- run Worker (RUN_PLAN §5.2, §5.3, T-S57) -------------------------
    {
      name: 'data-worker-imports-only-records',
      comment: 'The account data Worker may use contracts and library readers only, never machine or UI code.',
      severity: 'error',
      from: { path: '^workers/run-data/src/' },
      to: { path: `(^packages/|^apps/|^tools/|^workers/run/|${NPM})`, pathNot: '(^packages/(contracts|library)/|(^|/)node_modules/@synthetos/(contracts|library)/)' },
    },
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

    // --- Bootloader capability (ROADMAP P0-12, SAFETY T-S16) -------------
    {
      name: 'bootloader-capability-mint-is-flasher-only',
      comment:
        'Only the flasher mints a BootloaderCapability, the token that lets the Transport open at 1200 baud ' +
        '(the g2core SAM-BA touch that erases the board) or open a bootloader port (OLD-TP §4.2, SAFETY T-S16). ' +
        'The module that holds the mint may be imported by flasher source and by tests, never by anything else; ' +
        "everyone else gets the verifier through the package entry, which does not re-export the mint.",
      severity: 'error',
      from: { pathNot: '(^packages/flasher/src/|^packages/[^/]+/test/)' },
      to: { path: '(^packages/flasher/src/bootloaderCapability\\.ts$)' },
    },

    // --- Web Serial (ROADMAP P1-00, P1-01) --------------------------------
    {
      name: 'web-serial-transport-importers',
      comment:
        'The Web Serial transport is the only module that may touch navigator.serial ' +
        '(tools/gates/src/shared/webSerialNames.ts). Only the machine worker\'s transport seam ' +
        '(apps/web/src/machine-worker/transport.ts, which runs in machine.worker) and the machine ' +
        'package\'s own tests may import it. The machine package entry never re-exports it, so no ' +
        'other code (the main thread, the cloud client, another package) can open a port.',
      severity: 'error',
      from: { pathNot: '(^apps/web/src/machine-worker/transport\\.ts$|^packages/machine/test/)' },
      to: { path: '^packages/machine/src/webSerialTransport\\.ts$' },
    },

    {
      name: 'web-serial-transport-type-imports-only',
      comment:
        'The Web Serial transport imports types only. Its chunk then holds that one module ' +
        '(apps/web/build/chunks.ts files it under assets/serial/, the only place the bundle scan admits ' +
        'Web Serial), and the fake-serial test build, which does not contain it, still differs from ' +
        'production only in the seam (tools/gates/src/artifact/diff.ts). Runtime helpers (the open policy, ' +
        'the write guards) wrap it from outside: GuardedTransport, or values the seam passes in.',
      severity: 'error',
      from: { path: '^packages/machine/src/webSerialTransport\\.ts$' },
      to: { dependencyTypesNot: ['type-only'] },
    },

    {
      name: 'web-serial-chooser-importers',
      comment:
        "The window's port chooser (packages/machine/src/webSerialChooser.ts; OD-3, approved by the owner " +
        '2026-11-02) is the second and last module that may touch navigator.serial. It calls requestPort(), ' +
        "which exists only on Window, and describes the choice as a PortSelector; it never opens a port. " +
        'Exactly one main-thread module may import it, apps/web/src/live/portChooser.ts ' +
        '(tools/gates/src/shared/webSerialNames.ts, WEB_SERIAL_CHOOSER_IMPORTER), plus the machine ' +
        "package's own tests. The machine package entry never re-exports it.",
      severity: 'error',
      from: { pathNot: '(^apps/web/src/live/portChooser\\.ts$|^packages/machine/test/)' },
      to: { path: '^packages/machine/src/webSerialChooser\\.ts$' },
    },

    {
      name: 'web-serial-chooser-type-imports-only',
      comment:
        'The port chooser imports types only, so its page chunk holds that one module ' +
        '(apps/web/build/chunks.ts files it under assets/serial/, the only place the bundle scan admits ' +
        'Web Serial) and nothing else can join it.',
      severity: 'error',
      from: { path: '^packages/machine/src/webSerialChooser\\.ts$' },
      to: { dependencyTypesNot: ['type-only'] },
    },

    // --- The localhost bench build (P1-00, D41, accepted 2026-11-02) -----------------
    {
      name: 'bench-channel-only-through-the-build',
      comment:
        'The bench channel (apps/web/src/channel/bench.ts) reaches a build only through the bench build\'s ' +
        'seam swap (apps/web/build/bench.ts); no module imports it, and only it imports the bench marker. ' +
        'A release module importing either would put bench code in the deployed artifact (the bundle scan ' +
        'refuses the marker there as well). Tests may import them.',
      severity: 'error',
      from: { pathNot: '(^apps/web/src/channel/bench\\.ts$|^apps/web/test/|^tools/)' },
      to: { path: '^apps/web/src/channel/(bench|benchMarker)\\.ts$' },
    },
    {
      name: 'machine-path-never-reaches-build-channel',
      comment:
        'D1: nothing in the machine path consults the session or the build channel. machine.worker and the ' +
        'safety-path packages never import the build-channel seam (where the bench identity of P1-05 lives).',
      severity: 'error',
      from: { path: '(^apps/web/src/machine-worker/|^packages/)' },
      to: { path: '^apps/web/src/channel/' },
    },
    {
      name: 'machine-path-never-reaches-live-gates',
      comment:
        'D1, RUN_PLAN §2.2 "Where the gate lives" (P1-05): the AuthGate, the advisory gate and the rest of LIVE ' +
        'entry (apps/web/src/live/) and the cloud client are UI/auth layer. No chain of imports from machine.worker ' +
        'or a package reaches them, so an identity loss or a revocation can never act on the machine path.',
      severity: 'error',
      from: { path: '(^apps/web/src/machine-worker/|^packages/)' },
      to: { path: '^apps/web/src/(live|cloud)/', reachable: true },
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
      comment: 'Every import must resolve. The data entry has one explicitly checked runtime builtin below.',
      severity: 'error',
      from: { pathNot: '^workers/run-data/src/index\\.ts$' },
      to: { couldNotResolve: true },
    },
    { name: 'data-entry-runtime-import', severity: 'error', from: { path: '^workers/run-data/src/index\\.ts$' }, to: { couldNotResolve: true, pathNot: '^cloudflare:workers$' } },
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
        '^(packages|apps|workers|tools)/[^/]+/(dist|dist-fake-serial|dist-bench|coverage|\\.wrangler|test-results|playwright-report)/',
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
