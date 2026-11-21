/** The small line under a project file's name: size and date, plus the content hash at Advanced only. */
export function fileMetaText(size: string, added: string, hash: string, advanced: boolean): string {
  return `${size} · added ${added}${advanced ? ` · sha256 ${hash.slice(0, 10)}` : ''}`;
}
