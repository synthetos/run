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
 * THE ONE MODULE that may touch Web Serial (ROADMAP P1-01, owner approval to
 * lift the Phase 0 ban: P1-00). Repository-relative, forward slashes.
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
