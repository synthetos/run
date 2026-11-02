/**
 * Names that exist only on the Web Serial `Serial` object
 * (`navigator.serial`). A port can be opened only through one of them, so a
 * ban on the names catches code that reaches `navigator.serial` through an
 * alias. The ESLint rule `run/no-web-serial` (ROADMAP P0-02) and the bundle
 * scan (P0-13) both read this one list.
 *
 * This module has no dependencies, so the `build` CI job can run the bundle
 * scan without installing any dev tooling.
 */
export const WEB_SERIAL_METHODS: readonly string[] = ['requestPort', 'getPorts'];

/**
 * The navigator property that is the Web Serial API.
 */
export const WEB_SERIAL_PROPERTY = 'serial';

/**
 * THE TRANSPORT, the first of the two modules that may touch Web Serial
 * (ROADMAP P1-01, owner approval to lift the Phase 0 ban: P1-00). The other
 * is WEB_SERIAL_CHOOSER_MODULE below. Repository-relative, forward slashes.
 *
 * Every gate reads this constant, and each admits Web Serial here and
 * nowhere else:
 * - ESLint (eslint.config.js): `run/no-web-serial` does not apply to this
 *   file, and `run/no-capability-lookup` admits a static read of
 *   `navigator.serial` in this file only (no alias of `navigator`, no
 *   computed key, no `Reflect`, exactly as everywhere else);
 * - the source capability check (tools/gates/src/source) admits the same
 *   static read in this file only;
 * - dependency-cruiser lets only the machine worker's transport seam and
 *   the machine package's tests import it (`web-serial-transport-importers`),
 *   and lets it import types only (`web-serial-transport-type-imports-only`);
 * - the build files the chunk that holds it under `assets/serial/`
 *   (apps/web/build/chunks.ts), and the bundle scan admits Web Serial only
 *   in that chunk, only for the staging and bench targets, never for
 *   production (tools/gates/src/bundle/scan.ts).
 *
 * Changing it is a safety-path change (SAFETY §8).
 */
export const WEB_SERIAL_TRANSPORT_MODULE = 'packages/machine/src/webSerialTransport.ts';

/**
 * THE WINDOW'S PORT CHOOSER, the second and last module that may touch Web
 * Serial (OD-3 "The window's port chooser", approved by the owner
 * 2026-11-02, in its own reviewed change). `requestPort()` exists only on
 * Window, so the machine worker cannot call it. This module calls it,
 * reads the chosen port's `getInfo()` and its index in the window's
 * `getPorts()`, and returns a `PortSelector`. It never opens a port.
 *
 * Every gate admits it exactly as it admits the transport:
 * - ESLint: exempt from `run/no-web-serial`; a static `navigator.serial`
 *   read only;
 * - the source capability check: the same static read only;
 * - dependency-cruiser: exactly one main-thread importer,
 *   WEB_SERIAL_CHOOSER_IMPORTER (`web-serial-chooser-importers`), plus the
 *   machine package's tests; type-only imports
 *   (`web-serial-chooser-type-imports-only`);
 * - the page build files its chunk under `assets/serial/`
 *   (apps/web/build/chunks.ts); the bundle scan admits Web Serial there for
 *   staging and bench only, never production.
 *
 * Changing either constant is a safety-path change (SAFETY §8).
 */
export const WEB_SERIAL_CHOOSER_MODULE = 'packages/machine/src/webSerialChooser.ts';

/** The one main-thread module that may import the chooser (OD-3). */
export const WEB_SERIAL_CHOOSER_IMPORTER = 'apps/web/src/live/portChooser.ts';

/** Both modules that may touch Web Serial, and nothing else. */
export const WEB_SERIAL_MODULES: readonly string[] = Object.freeze([WEB_SERIAL_TRANSPORT_MODULE, WEB_SERIAL_CHOOSER_MODULE]);
