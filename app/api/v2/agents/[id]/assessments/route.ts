import { readAt } from "@/lib/server/chain";
import { deploymentById } from "@/lib/deployments";
import { apiError, HttpError } from "@/lib/server/auth";
import type { Assessment } from "@/lib/assurance";
import type { RecordPage } from "@/lib/records";
export const dynamic = "force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const {id}=await params;
    const query=new URL(request.url).searchParams;
    if(!/^[a-f0-9]{24}$/.test(id)|| (query.has("cursor")&&!/^\d{1,10}$/.test(query.get("cursor")!))) throw new HttpError(400,"Use a valid agent and cursor.");
    let deployment;
    try {deployment=deploymentById(query.get("deployment")??undefined);} catch {throw new HttpError(400,"Unknown deployment generation.");}
    if(!deployment.assurance) return Response.json({items:[],total:0,next_cursor:null,deployment:deployment.id});
    const page=await readAt<RecordPage<Assessment>>(deployment,"assurance","list_assessments",[id,query.has("cursor")?Number(query.get("cursor")):-1,50]);
    return Response.json({...page,deployment:deployment.id},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return apiError(error);}
}
