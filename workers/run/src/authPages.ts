/**
 * The one page run's `/auth/*` routes show when a sign-in cannot go on (ROADMAP A1-06).
 *
 * A short plain sentence and a link back to the app. The text is always one of this Worker's own constants: nothing
 * from the request, accounts or GitHub is ever echoed (no code, state, error description or cookie). Never cached.
 * The caller adds the security headers (index.ts), so the page runs under run's CSP with no script.
 */

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
}

/** An HTML page with `message` and a link to the app, with `status`. */
export function authProblem(status: number, message: string, extra: Record<string, string> = {}): Response {
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Synthetos Run: sign-in</title><main><h1>Sign-in</h1><p>${escapeHtml(message)}</p><p><a href="/">Back to Run</a></p></main></html>`;
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra } });
}
