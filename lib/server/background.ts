import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { encryptKey } from "../custody";
import { SERVICE_ID, PILOT_AGENT_LIMIT, SPONSORED_DAILY_LIMIT } from "../background";
import { activeDeployment, deploymentById } from "../deployments";
import { env } from "./env";
import { db } from "./db";
import { readAt } from "./chain";
import { submitAction, syncOperation } from "./operations";
import type { Action } from "../validation";
import type { Operation } from "../types";
import { operationRow, recoveryState } from "../operation-recovery";
import { HttpError } from "./auth";

export function stableRequestId(identity:string) {
  const hex=createHash("sha256").update(identity).digest("hex").slice(0,32).split("");
  hex[12]="4";hex[16]="a";
  const value=hex.join("");return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}
export async function ensureSponsor() {
  const key=env("BALLAST_SPONSOR_KEY") as `0x${string}`;
  if(!/^0x[a-f0-9]{64}$/i.test(key))throw new Error("Invalid sponsor configuration");
  const address=privateKeyToAccount(key).address;
  if(!activeDeployment.assurance)throw new Error("V2 assurance is not deployed");
  const config=await readAt<{sponsor:string}>(activeDeployment,"assurance","get_config",[]);
  if(config.sponsor.toLowerCase()!==address.toLowerCase())throw new Error("Sponsor address does not match the immutable assurance configuration");
  const sql=db();
  const encrypted=encryptKey(key,env("CUSTODY_MASTER_KEY"),SERVICE_ID);
  await sql`INSERT INTO ballast_accounts(privy_id,email,address,encrypted_key) VALUES(${SERVICE_ID},'service@ballast.invalid',${address},${encrypted}) ON CONFLICT(privy_id) DO NOTHING`;
  const [row]=await sql`SELECT address FROM ballast_accounts WHERE privy_id=${SERVICE_ID}`;
  if(row.address.toLowerCase()!==address.toLowerCase())throw new Error("Existing sponsor custody must not be overwritten");
}
export async function sponsoredAction(identity:string,action:Action):Promise<Operation|null> {
  await ensureSponsor();
  const sql=db();
  const request=stableRequestId(identity);
  const [prior]=await sql`SELECT * FROM ballast_operations WHERE user_id=${SERVICE_ID} AND idempotency_key=${request}`;
  if(prior && recoveryState(operationRow(prior))!=='retry')return syncOperation(SERVICE_ID,prior.id);
  if(prior?.next_retry_at && Date.parse(prior.next_retry_at)>Date.now())return null;
  const [pending]=await sql`SELECT * FROM ballast_operations WHERE user_id=${SERVICE_ID} AND status NOT IN ('FINALIZED','CANCELED','error') ORDER BY created_at LIMIT 1`;
  if(pending) {
    const reconciled=await syncOperation(SERVICE_ID,pending.id);
    if(!reconciled.retryable)return null;
  }
  // Assessments and monitoring yield whenever a claim has executable work.
  if(!['resolve','close_unresolved','finalize','settle','acknowledge','publish_confirmation'].includes(action.kind)) {
    const [readyCase]=await sql`SELECT id FROM ballast_jobs WHERE kind='case' AND status IN ('queued','running') AND payload->>'ready'='true' LIMIT 1`;
    if(readyCase)return null;
  }
  const lease=randomUUID();
  await sql`INSERT INTO ballast_sponsor_state(id) VALUES('pilot') ON CONFLICT DO NOTHING`;
  const admitted=await sql`UPDATE ballast_sponsor_state SET lease=${lease},lease_until=now()+interval '2 minutes',used_count=CASE WHEN usage_day=current_date THEN used_count+1 ELSE 1 END,usage_day=current_date WHERE id='pilot' AND (lease IS NULL OR lease_until<now()) AND (usage_day<>current_date OR used_count<${SPONSORED_DAILY_LIMIT}) AND NOT EXISTS(SELECT 1 FROM ballast_operations WHERE user_id=${SERVICE_ID} AND status NOT IN ('FINALIZED','CANCELED','error')) RETURNING id`;
  if(!admitted.length)return null;
  try {
    return await submitAction({id:SERVICE_ID,email:"service@ballast.invalid"},action,request);
  }finally{await sql`UPDATE ballast_sponsor_state SET lease=NULL WHERE id='pilot' AND lease=${lease}`;}
}
export async function prepareMonitoring(userId:string,agentId:string,deploymentId:string,enabled:boolean) {
  const sql=db();
  if(!enabled)return;
  const generation=deploymentById(deploymentId);
  if(!generation.assurance)throw new HttpError(409,"Monitoring requires v2 assurance.");
  const [account]=await sql`SELECT address FROM ballast_accounts WHERE privy_id=${userId}`;
  const agent=await readAt<{operator:string}>(generation,"registry","get_final_agent",[agentId]);
  if(!account||agent.operator.toLowerCase()!==account.address.toLowerCase())throw new HttpError(403,"Only this agent's operator may enable monitoring.");
  await sql`INSERT INTO ballast_monitor_slots(id) VALUES('pilot') ON CONFLICT DO NOTHING`;
  // Both the capacity decision and insertion run under the same transaction lock.
  await sql.transaction([
    sql`SELECT id FROM ballast_monitor_slots WHERE id='pilot' FOR UPDATE`,
    sql`INSERT INTO ballast_monitoring(deployment_id,agent_id,user_id,status) SELECT ${deploymentId},${agentId},${userId},'pending' WHERE (SELECT count(*) FROM ballast_monitoring WHERE status IN ('pending','active','paused'))<${PILOT_AGENT_LIMIT} ON CONFLICT(deployment_id,agent_id) DO UPDATE SET status=CASE WHEN ballast_monitoring.status='disabled' AND (SELECT count(*) FROM ballast_monitoring WHERE status IN ('pending','active','paused'))<${PILOT_AGENT_LIMIT} THEN 'pending' ELSE ballast_monitoring.status END`,
  ]);
  const [row]=await sql`SELECT user_id,status FROM ballast_monitoring WHERE deployment_id=${deploymentId} AND agent_id=${agentId}`;
  if(!row||row.user_id!==userId||row.status==='disabled')throw new HttpError(409,"The ten-agent sponsored pilot is full. Manual assessments remain available.");
}
export async function releaseMonitoringReservation(userId:string,agentId:string,deploymentId:string) {
  const sql=db();
  await sql`UPDATE ballast_monitoring SET status='disabled',pause_reason='Monitoring consent was not submitted.' WHERE user_id=${userId} AND deployment_id=${deploymentId} AND agent_id=${agentId} AND status='pending' AND NOT EXISTS(SELECT 1 FROM ballast_operations WHERE user_id=${userId} AND deployment_id=${deploymentId} AND kind='monitor' AND action->>'agentId'=${agentId} AND action->>'enabled'='true' AND status NOT IN ('error','CANCELED'))`;
}
export async function saveJob(kind:string,deploymentId:string,targetId:string,payload:Record<string,unknown>={}) {
  const sql=db();
  const id=`${deploymentId}:${kind}:${targetId}`;
  await sql`INSERT INTO ballast_jobs(id,kind,deployment_id,target_id,payload,status) VALUES(${id},${kind},${deploymentId},${targetId},${JSON.stringify(payload)}::jsonb,'queued') ON CONFLICT(id) DO UPDATE SET updated_at=CASE WHEN ballast_jobs.status IN ('complete','failed') THEN now() ELSE ballast_jobs.updated_at END,payload=CASE WHEN ballast_jobs.status IN ('complete','failed') THEN excluded.payload ELSE ballast_jobs.payload END,status=CASE WHEN ballast_jobs.status IN ('complete','failed') THEN 'queued' ELSE ballast_jobs.status END,epoch=CASE WHEN ballast_jobs.status IN ('complete','failed') THEN ballast_jobs.epoch+1 ELSE ballast_jobs.epoch END,segment=CASE WHEN ballast_jobs.status IN ('complete','failed') THEN 0 ELSE ballast_jobs.segment END,run_id=CASE WHEN ballast_jobs.status IN ('complete','failed') THEN NULL ELSE ballast_jobs.run_id END`;
  return id;
}
