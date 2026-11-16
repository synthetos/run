import { createHash } from 'node:crypto';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export class FakeFiles {
  values = new Map(); puts = []; failKey; pageSize = 500;
  seed(key, text, metadata = {}) {
    const bytes = Buffer.from(text);
    this.values.set(key, { bytes, etag: sha(bytes), customMetadata: metadata });
  }
  object(key) {
    const value = this.values.get(key);
    if (!value) return null;
    return { key, size: value.bytes.length, etag: value.etag, customMetadata: value.customMetadata,
      body: new Blob([value.bytes]).stream(), text: async () => value.bytes.toString() };
  }
  async head(key) { return this.object(key); }
  async get(key, options) {
    const object = this.object(key);
    if (object && options?.onlyIf.etagMatches !== object.etag) {
      if (options) return { ...object, body: undefined };
    }
    return object;
  }
  async list({ prefix = '', cursor = '', limit }) {
    const keys = [...this.values.keys()].sort().filter(k => k.startsWith(prefix) && k > cursor);
    const selected = keys.slice(0, Math.min(limit, this.pageSize));
    return { objects: selected.map(k => this.object(k)), truncated: keys.length > selected.length, cursor: selected.at(-1) };
  }
  async put(key, body, options = {}) {
    if (key === this.failKey) throw new Error('private bucket error');
    const old = this.values.get(key);
    if (options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== old?.etag) return null;
    const bytes = Buffer.from(await new Response(body).arrayBuffer());
    if (options.sha256 && sha(bytes) !== options.sha256) throw new Error('digest mismatch');
    this.values.set(key, { bytes, etag: sha(bytes), customMetadata: options.customMetadata ?? {} });
    this.puts.push({ key, streamed: body instanceof ReadableStream });
    return this.object(key);
  }
}
export function fileKey(text, suffix = 'token') { return `u/user/${sha(Buffer.from(text))}-${suffix}`; }
