/**
 * The test kit's marker (RUN_PLAN §5.3, SAFETY §8 item 31, T-S40).
 *
 * The bundle scan (tools/gates/src/bundle/scan.ts, ROADMAP P0-13) fails a
 * production build that contains `TESTKIT_MARKER`. A minifier renames
 * classes and drops unused exports, so a marker export alone would vanish
 * from a bundle that still ships test-kit code (a `VirtualClock` or a
 * `MockSerialPort` under a mangled name). So this module also has a side
 * effect that names the marker, and:
 *
 * - every module in `src/` imports this one (test/marker.test.ts enforces
 *   it), and
 * - package.json declares the whole package `"sideEffects": true`, so a
 *   bundler keeps this statement whenever any test-kit module is bundled,
 *   even through a bare `import '@synthetos/testkit'`.
 *
 * The side effect is a non-enumerable, read-only flag on `globalThis`. It
 * changes no behaviour; it only makes the test kit's presence visible, at
 * run time and in the built text.
 */

/** Marker that identifies the test kit. Its literal value is what the bundle scan looks for. */
export const TESTKIT_MARKER = '__SYNTHETOS_TESTKIT_DEV_ONLY__';

// Redefining a non-configurable property with an identical descriptor is
// allowed, so a second copy of this module (a test runner re-evaluating it)
// does not throw.
Object.defineProperty(globalThis, TESTKIT_MARKER, { value: true, enumerable: false, writable: false, configurable: false });
