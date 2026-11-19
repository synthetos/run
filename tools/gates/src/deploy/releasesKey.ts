/**
 * The run Worker's secrets file for `wrangler deploy --secrets-file`
 * (workflow/releasesKeyCredential.ts pins the step; releasesKey-cli.ts writes it).
 * The only secret is the read-only GitHub key for the TinyG release list, from the
 * environment secret RUN_GITHUB_RELEASES_TOKEN. With no key no file is written and
 * the deploy keeps whatever key the Worker already has (the file is additive).
 */

/** GitHub token alphabet; length bounds cover classic and fine-grained tokens. */
const TOKEN = /^[A-Za-z0-9_]{20,255}$/;

/** The secrets file body for this key, or null when there is no key. Throws on a malformed key, without echoing it. */
export function releasesSecrets(token: string | undefined): string | null {
  if (token === undefined || token === '') return null;
  if (!TOKEN.test(token)) throw new Error('RUN_GITHUB_RELEASES_TOKEN is not a GitHub token (letters, digits and underscores only). Save it again.');
  return `${JSON.stringify({ GITHUB_RELEASES_TOKEN: token })}\n`;
}
