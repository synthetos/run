import { expect, it, vi, afterEach } from 'vitest';
import { fetchToolCatalog } from '../src/cloud/catalog.ts';
import { readCatalog } from '../src/workspace/tools/catalogResponse.ts';
import { ONSRUD_CATALOG, CATALOG_VERSION } from '../../../workers/run/src/catalogData.ts';
afterEach(() => vi.unstubAllGlobals());
it('fetches only the same-origin path and handles HTTP, JSON and network failures', async () => {
  const fetch = vi.fn(async () => Response.json({version: CATALOG_VERSION, tools: ONSRUD_CATALOG})); vi.stubGlobal('fetch',fetch);
  const signal = new AbortController().signal;
  expect((await fetchToolCatalog(signal)).ok).toBe(true);
  expect(fetch).toHaveBeenCalledWith('/api/catalog/tools', { method:'GET', credentials:'same-origin', redirect:'error', signal });
  expect(await fetchToolCatalog(signal, async () => new Response(null, {status:503}))).toEqual({ok:false});
  expect(await fetchToolCatalog(signal, async () => new Response('invalid'))).toEqual({ok:false});
  expect(await fetchToolCatalog(signal, async () => { throw Error('offline'); })).toEqual({ok:false});
});
it('validates the version and all records, rejects invalid URLs and duplicate ids', () => {
  const payload = {version:CATALOG_VERSION,tools:ONSRUD_CATALOG};
  expect(readCatalog(payload)).toHaveLength(30); expect(Object.isFrozen(readCatalog(payload)![0])).toBe(true);
  for(const raw of [null,1,{}, {tools:[]}, {version:1,tools:[]}, {...payload,version:'bad'}, {...payload,tools:{}}, {...payload,tools:Array(1001).fill({})}, {...payload,tools:[{}]}, {...payload,tools:[ONSRUD_CATALOG[0],ONSRUD_CATALOG[0]]}, {...payload,tools:[{...ONSRUD_CATALOG[0],purchase:[{vendor:'bad',url:'javascript:bad',kind:'link'}]}]}]) expect(readCatalog(raw)).toBeNull();
  expect(readCatalog({...payload,tools:[]})).toEqual([]);
});
