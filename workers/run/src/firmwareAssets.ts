/** A current GitHub release asset eligible for digest-checked proxying. */
export interface FirmwareAsset {
  readonly env: 'staging' | 'production';
  /** `owner/name` on GitHub. */
  readonly repo: string;
  readonly tag: string;
  /** The release asset name (the listed `.hex`). */
  readonly asset: string;
  readonly sha256: string;
  readonly size: number;
}
