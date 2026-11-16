/** Record ids must survive both the account route and persisted cache validation. */
export const isRecordId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
