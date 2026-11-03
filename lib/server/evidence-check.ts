import "server-only";
import { lookup } from "node:dns/promises";
import { get } from "node:https";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { normalizePublicUrl } from "../evidence";

export function publicAddress(address:string) {
  if(isIP(address)!==4)return false; // Keep the pilot on explicitly screened IPv4 destinations.
  const [a,b]=address.split('.').map(Number);
  return !([0,10,127].includes(a)||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&[0,168].includes(b))||(a===100&&b>=64&&b<=127)||(a===198&&[18,19].includes(b)));
}
export async function evidenceDigest(urls:string[]) {
  const digests:Record<string,string>={};
  const deadline=Date.now()+60000;
  for(const raw of urls.slice(0,24)) {
    if(Date.now()>=deadline)break;
    const url=normalizePublicUrl(raw);
    if(!url)continue;
    try {
      const addresses=await new Promise<{address:string;family:number}[]>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('DNS timeout')),Math.min(5000,Math.max(1,deadline-Date.now())));
        lookup(new URL(url).hostname,{all:true,family:4}).then(resolve,reject).finally(()=>clearTimeout(timer));
      });
      if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))continue;
      const body=await new Promise<string>((resolve,reject)=>{
        const request=get(url,{family:4,signal:AbortSignal.timeout(Math.min(10000,Math.max(1,deadline-Date.now()))),lookup:(_hostname,_options,callback)=>callback(null,addresses[0].address,4)},response=>{
          if(response.statusCode!==200){response.resume();reject(new Error('Unavailable evidence'));return;}
          const chunks:Buffer[]=[];let length=0;
          response.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>512*1024){request.destroy(new Error('Evidence too large'));return;}chunks.push(chunk);});
          response.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
          response.on('error',reject);
        });
        request.setTimeout(10000,()=>request.destroy(new Error('Evidence timeout')));
        request.on('error',reject);
      });
      if(body.trim().length<20)continue;
      digests[url]=createHash('sha256').update(body).digest('hex');
    }catch { /* An outage is missing evidence, never a negative agent finding. */ }
  }
  const hosts=new Set(Object.keys(digests).map(url=>new URL(url).hostname));
  return {complete:hosts.size>=2,digest:createHash('sha256').update(JSON.stringify(Object.entries(digests).sort())).digest('hex')};
}
