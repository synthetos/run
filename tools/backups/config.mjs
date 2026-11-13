export const REPO = 'run';
// Add production run-data as one entry here only after that database exists and is provisioned.
export const DATABASES = [
  { name: 'run-auth', staging: 'run-auth-staging', tables: ['auth_requests', 'devices', 'login_rate'], nonempty: [] },
];
