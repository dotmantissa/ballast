import { db } from "@/lib/server/db";
import { launchJob, queueDomainJob, queueOperation } from "@/lib/server/job-queue";
export const maxDuration=300;
export async function GET(request:Request) {
  if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return Response.json({error:'Unauthorized'},{status:401});
  const sql=db();
  try {
    const orphaned=await sql`SELECT id,user_id,action FROM ballast_operations WHERE action IS NOT NULL AND user_id<>'service:ballast:v2' AND NOT EXISTS(SELECT 1 FROM ballast_jobs WHERE kind='operation' AND target_id=ballast_operations.id::text) ORDER BY created_at LIMIT 20`;
    for(const operation of orphaned)await queueOperation(operation.user_id,operation.id,operation.action);
    const jobs=await sql`SELECT id FROM ballast_jobs WHERE status IN ('queued','running') ORDER BY CASE WHEN kind='case' THEN 0 ELSE 1 END,updated_at LIMIT 20`;
    for(const job of jobs)await launchJob(job.id);
    const subscriptions=await sql`SELECT deployment_id,agent_id FROM ballast_monitoring WHERE status IN ('active','paused','pending') ORDER BY last_checked_at NULLS FIRST LIMIT 10`;
    for(const subscription of subscriptions)await queueDomainJob('monitor',subscription.deployment_id,subscription.agent_id);
    return Response.json({queued:jobs.length,checked:subscriptions.length});
  }catch{console.error('ballast.dispatch.unavailable');return Response.json({error:'Background dispatch is temporarily unavailable.'},{status:503});}
}
