import { readTool, type Tool } from '@synthetos/library';
/** Treat catalog responses like imported records; no URL becomes a network request here. */
export function readCatalog(value: unknown): readonly Tool[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const data = value as { version?: unknown; tools?: unknown };
  if (typeof data.version !== 'string' || !/^[a-f0-9]{64}$/.test(data.version) || !Array.isArray(data.tools) || data.tools.length > 1000) return null;
  const tools: Tool[] = []; const seen = new Set<string>();
  for (const raw of data.tools) {
    const parsed = readTool(raw);
    if (!parsed.ok || seen.has(parsed.value.id)) return null;
    seen.add(parsed.value.id); tools.push(parsed.value);
  }
  return tools;
}
