# Accounts sign-in: owner checklist

Staging first. No production opening until the staging checks pass. The detailed steps and exact fields are in [go-live-staging.md](go-live-staging.md).

- [ ] Publish `synthetos/accounts` as a **private** repository. Set required checks and protected staging/production environments. Keep deployments disabled initially.
- [ ] Register the separate **Synthetos Staging** GitHub App, with no permissions and the accounts staging callback. Keep the existing Synthetos production app. Store credentials in the password manager, never the repository.
- [ ] Create a separate D1-only token. Put `CLOUDFLARE_D1_API_TOKEN` in both repositories' protected environments. Remove D1 permission from `CLOUDFLARE_API_TOKEN`. Merge the accounts companion workflow change before deployment.
- [ ] Create `identity-staging` and `run-auth-staging` in the current Cloudflare account. Submit their ids and the staging App/Client ids as reviewed configuration changes. Keep `GITHUB_ALLOWED_IDS` limited to the approved numeric ids.
- [ ] Protect both staging hosts with Cloudflare Access. Verify the D39 account controls. Enable CI deploys, deploy accounts first, then run. CI applies migrations and registers the run client; set application secrets using the runbook.
- [ ] Verify sign-in, sign-out, revoked-session refusal, a non-allowlisted refusal, and the Access pre/post checks. Production remains unconfigured.
- [ ] When approved to open production, create `identity` and `run-auth`, add the reviewed production bindings and migration step, set separate production secrets, and deploy accounts before run through CI. Complete the signed-data and hardware checks in §7. Production Connect remains read-only.

Never deploy from a local wrangler login. No extra run OAuth app or entitlement service is needed.
