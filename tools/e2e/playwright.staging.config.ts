/**
 * The staging headers suite (P1-00): `*.staging.ts` specs against `wrangler
 * dev --env staging`, with the Worker seeing every request as
 * https://staging.run.synthetos.com (src/served.ts STAGING_DEV_ARGS). It
 * serves the same tree as the main suite (the built shell in source mode,
 * the attested artifact in artifact mode), through the staging asset
 * settings: the Worker first for every path, granting `serial=(self)`.
 * Same origin guard as every suite.
 */
import { suiteConfig } from './src/suite.ts';

export default suiteConfig({ name: 'staging', port: 8792, testMatch: '**/*.staging.ts', modes: ['source', 'artifact'], environment: 'staging' });
