import { describe, expect, it } from 'vitest';
import { BUILTIN_MATERIALS } from '@synthetos/library';
import { ACCOUNT_STORAGE_BYTES } from '@synthetos/contracts';
import { RecordStore } from '../src/store.ts';
import { database } from './harness.ts';
const a = { userId: 'usr_alice', label: '@alice' }; const b = { userId: 'usr_bob', label: '@bob' };
const content = { ...BUILTIN_MATERIALS[0]!, id: 'mine.material' };
describe('account records in real SQLite with fake D1 bindings', () => {
  it('isolates list/get/put/archive even when ids and revisions are guessed', async () => {
    const { db, sql } = database(); const store = new RecordStore(db);
    expect((await store.put(a,'material',content.id,null,content)).ok).toBe(true);
    expect(await store.list(b,'material')).toEqual([]); expect(await store.get(b,'material',content.id)).toEqual({ ok:false,error:'not_found' });
    expect(await store.put(b,'material',content.id,1,{ ...content, name:'attack' })).toMatchObject({ok:false,error:'conflict',current:null});
    expect(await store.archive(b,'material',content.id,1)).toEqual({ok:false,error:'not_found'});
    expect((await store.put(b,'material',content.id,null,{...content,name:'Bob copy'})).ok).toBe(true);
    expect(await store.get(a,'material',content.id)).toMatchObject({ok:true,record:{rev:1,content:{name:content.name}}});
    expect(sql.prepare('SELECT COUNT(*) n FROM changes').get()).toMatchObject({n:2}); sql.close();
  });
  it('CAS preserves history and audit; stale writes and archive cannot overwrite', async () => {
    const {db,sql}=database(); const store=new RecordStore(db);
    await store.put(a,'material',content.id,null,content);
    await store.put(a,'material',content.id,1,{...content,name:'second'});
    expect(await store.put(a,'material',content.id,1,{...content,name:'stale'})).toMatchObject({ok:false,error:'conflict',current:{rev:2}});
    expect(await store.archive(a,'material',content.id,1)).toMatchObject({ok:false,error:'conflict'});
    expect((await store.archive(a,'material',content.id,2)).ok).toBe(true);
    expect(await store.list(a,'material')).toEqual([]);
    expect(await store.put(a,'material',content.id,2,content)).toMatchObject({ok:false,error:'conflict'});
    expect(sql.prepare('SELECT COUNT(*) n FROM record_revisions').get()).toMatchObject({n:2});
    expect(sql.prepare('SELECT COUNT(*) n FROM changes').get()).toMatchObject({n:3});
    expect(() => sql.exec("UPDATE record_revisions SET actor_label='x'")).toThrow('append_only'); sql.close();
  });
  it('validates ids/content, binds user id first and refuses safety fields', async () => {
    const {db,sql}=database(); const store=new RecordStore(db);
    expect(await store.put(a,'material',content.id,null,{...content,deviceSafety:{homed:true}})).toMatchObject({ok:false,error:'invalid'});
    expect(await store.put(a,'material','other',null,content)).toMatchObject({ok:false,error:'invalid'});
    expect(await store.put(a,'tool',content.id,null,content)).toMatchObject({ok:false,error:'invalid'});
    expect(await store.get(a,'material',"' OR 1=1")).toMatchObject({ok:false,error:'invalid'}); sql.close();
  });
  it('counts UTF-8 content and retained revisions against the shared quota; rollback is atomic', async () => {
    const {db,sql}=database(); const store=new RecordStore(db);
    await store.put(a,'material',content.id,null,content);
    const before=sql.prepare('SELECT * FROM account_storage WHERE user_id=?').get(a.userId)!;
    expect(before['limit_bytes']).toBe(ACCOUNT_STORAGE_BYTES);
    expect(before['used_bytes']).toBe(new TextEncoder().encode(JSON.stringify(content)).length);
    sql.prepare('UPDATE account_storage SET limit_bytes=used_bytes WHERE user_id=?').run(a.userId);
    expect(await store.put(a,'material',content.id,1,content)).toEqual({ok:false,error:'quota'});
    expect(await store.get(a,'material',content.id)).toMatchObject({ok:true,record:{rev:1}});
    expect(sql.prepare('SELECT COUNT(*) n FROM changes').get()).toMatchObject({n:1}); sql.close();
  });
});

it('two concurrent writes to one parent produce one revision and one conflict', async () => {
  const {db,sql}=database(); const store=new RecordStore(db);
  await store.put(a,'material',content.id,null,content);
  const results=await Promise.all([store.put(a,'material',content.id,1,{...content,name:'first'}),store.put(a,'material',content.id,1,{...content,name:'second'})]);
  expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results.filter(r=>!r.ok && r.error==='conflict')).toHaveLength(1);
  expect(sql.prepare('SELECT COUNT(*) n FROM record_revisions').get()).toMatchObject({n:2});sql.close();
});
it('valid tools use the same revision and validation rules', async () => {
 const {db,sql}=database();const store=new RecordStore(db);
 const tool={id:'mine.tool',version:1,name:'End mill',type:'flat',geometry:{diameter:6.35,shank:6.35,flutes:2,fluteLength:12,overallLength:38},toolMaterial:'carbide',coating:'uncoated',description:'',notes:'',purchase:[],cuttingData:[],life:{minutes:0,byMaterial:[]},tags:[],images:[]};
 expect(await store.put(a,'tool',tool.id,null,tool)).toMatchObject({ok:true,record:{rev:1}});
 expect(await store.put(a,'tool',tool.id,1,{...tool,geometry:{...tool.geometry,diameter:-1}})).toMatchObject({ok:false,error:'invalid'});
 expect(await store.list(a,'tool')).toHaveLength(1);expect(await store.list(b,'tool')).toHaveLength(0);sql.close();
});
