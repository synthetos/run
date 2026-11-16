export function workerConfig(environment: string, source: string | Record<string, string>, scratch: string, options?: string | { account?: string | undefined; files?: boolean }): Record<string, unknown>;
export function checkBackupConfig(config: unknown, environment?: string): boolean;
