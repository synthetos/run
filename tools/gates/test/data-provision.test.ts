import { expect, it } from 'vitest';
import { provisionData, type ApiFetch } from '../src/deploy/dataProvision.ts';
import { dataDeployConfig } from '../src/deploy/dataConfig.ts';
const account='a'.repeat(32);const uuid='11111111-1111-1111-1111-111111111111';
function fake(missing='',exists=false) {
 const writes:string[]=[];
 const fetcher:ApiFetch=async(url,init)=>{
  const token=(init.headers as Record<string,string>)['authorization'];
  const permissions=token==='Bearer deploy'?['Workers Scripts Write','Workers R2 Storage Write']:['D1 Write'];
  let result:unknown;
  if(url.endsWith('/verify'))result={id:'token',status:'active'};
  else if(url.endsWith('/tokens/token')) result={policies:[{effect:'allow',resources:{[`com.cloudflare.api.account.${account}`]:'*'},permission_groups:permissions.filter(p=>p!==missing).map(name=>({name}))}]};
  else if(init.method==='POST'){writes.push(url);result={uuid};}
  else if(url.includes('/d1/database'))result=exists?[{name:'run-data-staging',uuid}]:[];
  else result={buckets:exists?[{name:'run-files-staging'}]:[]};
  return Response.json({success:true,result});
 };return{fetcher,writes};
}
it.each(['Workers Scripts Write','Workers R2 Storage Write','D1 Write'])('missing %s fails before creating anything',async(permission)=>{
 const {fetcher,writes}=fake(permission);await expect(provisionData(account,'deploy','d1',fetcher)).rejects.toThrow(permission);expect(writes).toEqual([]);
});
it('creates missing resources, resolves the id, and leaves existing resources alone',async()=>{
 const first=fake();expect(await provisionData(account,'deploy','d1',first.fetcher)).toBe(uuid);expect(first.writes).toHaveLength(2);
 const next=fake('',true);expect(await provisionData(account,'deploy','d1',next.fetcher)).toBe(uuid);expect(next.writes).toHaveLength(0);
 const c=dataDeployConfig(account,uuid);expect(c).toMatchObject({workers_dev:false,preview_urls:false,routes:[],name:'run-data-staging'});expect(c).not.toHaveProperty('build');
});
it('a denied policy read names its token and permission and makes no resources',async()=>{
 await expect(provisionData(account,'deploy','d1',async()=>new Response('',{status:403}))).rejects.toThrow('CLOUDFLARE_API_TOKEN: add Account API Tokens Read');
});

it('supports account-owned tokens when user-token verification refuses them',async()=>{
 const original=fake('',true);const fetcher:ApiFetch=async(url,init)=>url.endsWith('/user/tokens/verify')?new Response('',{status:401}):original.fetcher(url,init);
 expect(await provisionData(account,'deploy','d1',fetcher)).toBe(uuid);expect(original.writes).toHaveLength(0);
});
