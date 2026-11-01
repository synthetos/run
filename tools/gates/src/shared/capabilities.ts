/**
 * The admitted ways for runtime code to touch the browser's capability
 * objects (P0 review fix pass, P0-13). Web Serial must not be reachable
 * through a computed or reflective lookup such as
 * `Reflect.get(navigator, ['ser', 'ial'].join(''))`, which no name ban can
 * see. Arbitrary JavaScript cannot be proven safe by pattern, so the gates
 * do not try to recognise bad lookups: they admit only a narrow set of
 * static forms and refuse everything else.
 *
 * - `navigator` (and Chrome's alias `clientInformation`) may appear only as a
 *   static read of one of `NAVIGATOR_ALLOWED_PROPERTIES`, or under `typeof`.
 *   Passing it, aliasing it, a computed member, `in`, or the name as a string
 *   are all refused.
 * - A window alias (`GLOBAL_OBJECT_NAMES`, or a member named in
 *   `WINDOW_PROPERTY_NAMES` such as `document.defaultView`) may appear only
 *   as the object of a member access with a static key, under `typeof`, or as
 *   the right-hand side of `'name' in`. A computed key, or the object used as
 *   a value, is refused.
 * - `Reflect` is refused outright: runtime source has no use for it.
 * - An `import()` whose specifier is not a literal string is refused, since
 *   no dependency rule can check an edge chosen at run time (P0-14).
 *
 * Three gates read this one list: the ESLint rules `run/no-capability-lookup`
 * and `run/no-dynamic-import`, the source check that `pnpm deps` runs after
 * dependency-cruiser (tools/gates/src/source), and the bundle scan.
 *
 * The browser backstop is independent of all three: Phase 0 serves
 * `Permissions-Policy: serial=()` (workers/run/src/headers.ts).
 *
 * Residual, stated plainly: a computed member on an arbitrary object
 * (`el.ownerDocument['default' + 'View']`) cannot be told apart from
 * ordinary indexing by any of these gates. `serial=()` is what holds there.
 *
 * Dependency-free, so the secret-free `build` CI job can run the bundle scan.
 */

/** The navigator object's global names. */
export const NAVIGATOR_NAMES: readonly string[] = ['navigator', 'clientInformation'];

/**
 * Navigator properties runtime code may read. Each is plain data (strings
 * and a boolean), never an object that leads to a device API. Adding one is
 * a safety-path change (SAFETY §8).
 */
export const NAVIGATOR_ALLOWED_PROPERTIES: readonly string[] = ['language', 'languages', 'onLine', 'userAgent'];

/** Global names that denote a window or worker global object. */
export const GLOBAL_OBJECT_NAMES: readonly string[] = ['globalThis', 'window', 'self', 'global', 'top', 'parent', 'frames', 'opener'];

/**
 * Global names that are also common local names. The ESLint rule uses scope
 * analysis for these, and the source check treats a file that declares one
 * as using its own binding. `globalThis`, `window` and `self` are always the
 * global in the source check (rename a local that shadows them).
 */
export const SHADOWABLE_GLOBAL_NAMES: readonly string[] = ['global', 'top', 'parent', 'frames', 'opener'];

/** Member names whose value is a window (or the global object). */
export const WINDOW_PROPERTY_NAMES: readonly string[] = ['globalThis', 'window', 'self', 'frames', 'opener', 'defaultView', 'contentWindow'];

/** Globals refused outright in runtime source. */
export const REFLECTIVE_GLOBALS: readonly string[] = ['Reflect'];
