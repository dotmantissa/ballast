import { authenticate, apiError, HttpError } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { deploymentById } from "@/lib/deployments";
export async function GET(request:Request) {
  try {
    const user=await authenticate(request);
    const query=new URL(request.url).searchParams;
    const agentId=query.get("agentId");
    if(!agentId||!/^[a-f0-9]{24}$/.test(agentId))throw new HttpError(400,"Use a valid agent ID.");
    let generation;
    try {generation=deploymentById(query.get("deployment")??undefined);}catch{throw new HttpError(400,"Unknown deployment generation.");}
    const sql=db();
    const [subscription]=await sql`SELECT agent_id,deployment_id,status,last_checked_at,next_review_at,pause_reason FROM ballast_monitoring WHERE user_id=${user.id} AND agent_id=${agentId} AND deployment_id=${generation.id}`;
    return Response.json({subscription:subscription??null},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return apiError(error);}
}
