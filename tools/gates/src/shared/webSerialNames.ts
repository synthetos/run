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
