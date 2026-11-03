import { spawn } from 'node:child_process';
import { neonConfig } from '@neondatabase/serverless';
// Local-only transport fallback. The connection header travels over stdin, never argv or logs.
if(process.env.BALLAST_CURL_DB==='1') {
  neonConfig.fetchFunction=async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const url=String(input);
    if(!/^https:\/\/[a-z0-9.-]+\.neon\.tech\/sql$/.test(url))throw Error('Unexpected database endpoint');
    const quote=(value:string)=>'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r')+'"';
    const config=['url = '+quote(url),'request = "POST"',...Array.from(new Headers(init?.headers).entries(),([k,v])=>'header = '+quote(k+': '+v)),'data = '+quote(String(init?.body))].join('\n');
    const output=await new Promise<string>((resolve,reject)=>{
      const child=spawn('curl',['--silent','--show-error','--max-time','45','--config','-'],{stdio:['pipe','pipe','pipe']});
      const chunks:Buffer[]=[];child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.resume();
      child.on('error',()=>reject(Error('Database transport unavailable')));
      child.on('close',code=>code===0?resolve(Buffer.concat(chunks).toString()):reject(Error('Database transport did not complete')));
      child.stdin.end(config);
    });
    let response;try{response=JSON.parse(output);}catch{throw Error('Database response is unavailable');}
    return new Response(output,{status:response.message&&!response.results&&!response.fields?400:200,headers:{'Content-Type':'application/json'}});
  };
}
