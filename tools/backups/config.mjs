export const REPO = 'run';
// The reviewed databases eligible for owner-approved recovery; provisioning creates none here.
export const DATABASES = [
  { name: 'run-data', staging: 'run-data-staging', tables: ['account_storage', 'records', 'record_revisions', 'changes', 'files'], nonempty: [] },
  { name: 'run-auth', staging: 'run-auth-staging', tables: ['auth_requests', 'devices', 'login_rate'], nonempty: [] },
];
