/**
 * The release key file must live outside the repository (docs/ops/release-key.md).
 * `relative()` gives `..` or a path starting with `../` for a file outside `root`, and an
 * absolute path when it is on another drive (Windows). A name that only begins with two dots
 * (`..release.pkcs8.pem`) is inside the repository.
 */
import { isAbsolute, relative, sep } from 'node:path';

export function isOutsideRepo(root: string, keyPath: string): boolean {
  const rel = relative(root, keyPath);
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}
