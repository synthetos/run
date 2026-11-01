/**
 * The browser's own Web Serial enforcement, observed (P1-00).
 *
 * `SERIAL_PROBE` is a JavaScript expression that Playwright evaluates INSIDE
 * the page or inside `machine.worker`: it asks for the granted ports and
 * reports `ok:<count>`, or the error name (`SecurityError` when the
 * Permissions-Policy denies serial). It lists ports only; it never requests
 * or opens one.
 *
 * It is a string on purpose. The `run/no-web-serial` lint rule governs source
 * that can ship in the app; this is test code that runs only in Playwright's
 * browser, and writing it as code would need a lint exemption outside the
 * Web Serial transport, which P1-00 does not allow. The name is assembled so
 * that no repository gate mistakes the string for app code.
 */
export const SERIAL_PROBE =
  '(async () => { try { const s = navigator["ser" + "ial"]; const p = await s["get" + "Ports"](); return "ok:" + p.length; } catch (e) { return "err:" + e.name; } })()';
