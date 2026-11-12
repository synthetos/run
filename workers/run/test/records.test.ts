import { expect, it } from 'vitest';
import type { RunDataBinding, RecordActor } from '@synthetos/contracts';
import { route } from '../src/routes.ts';
import { authEnv } from './authHarness.ts';
function setup() {
  const {env}=authEnv('staging',()=>Math.floor(Date.now()/1000)); const actors:RecordActor[]=[];
  env.ACCOUNTS!.validateSession=async()=>({id:'session',sub:'usr_alice',name:'alice',client:'run',identities:[{provider:'github',id:'1',login:'alice'}],absoluteExpiresAt:Math.floor(Date.now()/1000)+600,deviceRecordId:null,sharedComputer:false});
  const data:RunDataBinding={ list:async(actor)=>{actors.push(actor);return[];},get:async(actor)=>{actors.push(actor);return {ok:false,error:'not_found'};},put:async(actor)=>{actors.push(actor);return {ok:false,error:'conflict',current:null};},archive:async(actor)=>{actors.push(actor);return {ok:false,error:'not_found'};} };
  return {env:{...env,RUN_DATA:data},actors};
}
const request=(path:string,method='GET',payload?:unknown, extra:Record<string,string>={})=>new Request(`https://staging.run.synthetos.com/api/records/${path}`,{method,headers:{cookie:'__Host-run_sid='+ Buffer.alloc(32,1).toString('base64url'),origin:'https://staging.run.synthetos.com','sec-fetch-site':'same-origin','x-synthetos-request':'1','content-type':'application/json',...extra},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
it('requires the run session, including on reads; Access is not an account',async()=>{
 const {env,actors}=setup();env.ACCOUNTS!.validateSession=async()=>null;
 expect((await route(request('tool'),env)).status).toBe(401);expect(actors).toEqual([]);
});
it('uses only the validated subject for every operation',async()=>{
 const {env,actors}=setup();
 for(const [path,method,payload] of [['tool','GET',undefined],['tool/mine.t1','GET',undefined],['tool/mine.t1','PUT',{parent_rev:null,content:{}}],['tool/mine.t1','DELETE',{parent_rev:1}]] as const) await route(request(path,method,payload),env);
 expect(actors).toHaveLength(4);expect(actors.every(a=>a.userId==='usr_alice' && a.label==='@alice')).toBe(true);
});
it('rejects forged user fields, unsafe methods, cross-origin mutations and oversized bodies',async()=>{
 const {env,actors}=setup();
 expect((await route(request('tool/mine.t1','PUT',{parent_rev:null,content:{},user_id:'usr_bob'}),env)).status).toBe(400);
 expect((await route(request('tool/mine.t1','POST',{}),env)).status).toBe(405);
 expect((await route(request('tool/mine.t1','PUT',{}, {origin:'https://evil.example'}),env)).status).toBe(403);
 expect((await route(request('tool/mine.t1','PUT',{}, {'x-synthetos-request':''}),env)).status).toBe(403);
 expect((await route(request('tool/mine.t1','PUT',{parent_rev:null,content:'x'.repeat(72000)}),env)).status).toBe(400);
 expect((await route(request('tool?user_id=usr_bob'),env)).status).toBe(400); expect(actors).toEqual([]);
});
it('passes an explicit archived-record listing flag and rejects other values', async () => {
 const {env}=setup(); const flags:boolean[]=[];
 env.RUN_DATA.list=async(_actor,_kind,_after,includeArchived)=>{flags.push(includeArchived!);return[];};
 expect((await route(request('tool?include_archived=1'),env)).status).toBe(200);
 expect((await route(request('tool'),env)).status).toBe(200);
 expect(flags).toEqual([true,false]);
 expect((await route(request('tool?include_archived=yes'),env)).status).toBe(400);
});
