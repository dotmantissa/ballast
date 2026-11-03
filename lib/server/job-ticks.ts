import "server-only";
import { db } from "./db";
import { deploymentById, deployments } from "../deployments";
import { readAt } from "./chain";
import { syncOperation } from "./operations";
import { sponsoredAction } from "./background";
import { nextCaseAction, nextAssessmentAction, monitoringSources } from "../background";
import { queueDomainJob } from "./job-queue";
import { evidenceDigest } from "./evidence-check";
import type { Action } from "../validation";
import type { Claim } from "../types";
import type { Assessment, Passport } from "../assurance";
import { TERMINAL_STATUSES } from "../operation-recovery";
type Tick = {done:boolean;delaySeconds:number};

export async function runJobTick(jobId:string,epoch?:number,segment?:number):Promise<Tick> {
  const sql=db();
  const [job]=await sql`SELECT * FROM ballast_jobs WHERE id=${jobId}`;
  if(!job||job.status==='complete'||job.status==='failed'||(epoch!==undefined&&job.epoch!==epoch)||(segment!==undefined&&job.segment!==segment))return {done:true,delaySeconds:0};
  const generation=deploymentById(job.deployment_id);
  if(generation.testOnly&&job.kind!=='operation'){await sql`UPDATE ballast_jobs SET status='complete',pause_reason='Isolated validation uses its own test signer.' WHERE id=${jobId}`;return {done:true,delaySeconds:0};}
  const now=Math.floor(Date.now()/1000);
  const done=async()=>{await sql`UPDATE ballast_jobs SET status='complete',pause_reason=NULL,updated_at=now() WHERE id=${jobId}`;return {done:true,delaySeconds:0};};
  const wait=async(reason:string,delaySeconds=300)=>{await sql`UPDATE ballast_jobs SET pause_reason=${reason},updated_at=now() WHERE id=${jobId}`;return {done:false,delaySeconds};};
  const send=async(action:Action,revision:string)=>{
    const operation=await sponsoredAction(`${jobId}:${revision}:${JSON.stringify(action)}`,{...action,deployment:generation.id});
    if(!operation)return wait('Waiting for sponsor capacity or a previous transaction.',300);
    if(operation.execution==='error')return wait('The network review needs retry; no negative finding has been assumed.',300);
    return wait('Waiting for a finalized transaction.',30);
  };
  try {
    if(job.kind==='operation') {
      const operation=await syncOperation(job.payload.userId,job.target_id);
      if(!TERMINAL_STATUSES.includes(operation.status)&&operation.status!=='error')return wait('Reconciling the saved user transaction.',30);
      const action=job.payload.action as Action;
      if(operation.execution!=='success') {
        if(action.kind==='monitor'&&action.enabled)await sql`UPDATE ballast_monitoring SET status='disabled',pause_reason='Monitoring enablement did not finalize successfully.' WHERE deployment_id=${generation.id} AND agent_id=${action.agentId} AND status='pending'`;
        return done();
      }
      if(action.kind==='monitor') {
        const passport=await readAt<Passport>(generation,'assurance','get_passport',[action.agentId]);
        await sql`UPDATE ballast_monitoring SET status=${passport.monitoring?'active':'disabled'},pause_reason=NULL,next_review_at=COALESCE(next_review_at,now()) WHERE deployment_id=${generation.id} AND agent_id=${action.agentId}`;
        if(passport.monitoring)await queueDomainJob('monitor',generation.id,action.agentId);
      }
      if(action.kind==='assess') {
        const passport=await readAt<Passport>(generation,'assurance','get_passport',[action.agentId]);
        if(passport.assessment)await queueDomainJob('assessment',generation.id,passport.assessment.id);
      }
      if('assessmentId' in action)await queueDomainJob('assessment',generation.id,action.assessmentId);
      if('claimId' in action)await queueDomainJob('case',generation.id,action.claimId);
      if(action.kind==='claim') {
        const [row]=await sql`SELECT address FROM ballast_accounts WHERE privy_id=${job.payload.userId}`;
        const cases=await readAt<{items:Claim[];next_cursor:number|null}>(generation,'court','list_account_claims',[row.address,true,-1,50]);
        const claim=cases.items.find(c=>c.policy_id===action.policyId&&c.incident_ref===action.incidentRef);
        if(claim)await queueDomainJob('case',generation.id,claim.id);
      }
      return done();
    }
    if(job.kind==='case') {
      const claim=await readAt<Claim>(generation,'court','get_claim',[job.target_id]);
      if(claim.status==='settled')return done();
      const action=nextCaseAction(claim,now);
      await sql`UPDATE ballast_jobs SET payload=jsonb_set(payload,'{ready}',${JSON.stringify(!!action)}::jsonb) WHERE id=${jobId}`;
      if(!action)return wait('Waiting for the fixed case challenge window.',Math.max(30,Math.min(86400,claim.challenge_until-now)));
      if(action.kind==='settle') {
        try {await readAt(generation,'court','get_final_claim',[claim.id]);}
        catch{return send({kind:'publish_confirmation',target:'claim',recordId:claim.id},'decision-proof');}
        const settlement=await readAt<{id?:string}>(generation,'underwriting','get_final_settlement',[claim.id]);
        if(settlement.id)return send({kind:'acknowledge',claimId:claim.id},'acknowledge');
        const raw=await readAt<{id?:string}>(generation,'underwriting','get_settlement',[claim.id]);
        if(raw.id)return send({kind:'publish_confirmation',target:'settlement',recordId:claim.id},'settlement-proof');
      }
      return send(action,`${claim.eligibility_revision}:${claim.appeals.length}:${claim.effective_evidence_urls.join('|')}`);
    }
    if(job.kind==='assessment') {
      const assessment=await readAt<Assessment>(generation,'assurance','get_assessment',[job.target_id]);
      if(['disputed','evidence_timeout'].includes(assessment.status))return done();
      if(assessment.status==='final') {
        try {await readAt(generation,'assurance','get_final_assessment',[assessment.id]);return done();}
        catch{return send({kind:'publish_assessment',assessmentId:assessment.id},'proof');}
      }
      const action=nextAssessmentAction(assessment,now);
      if(!action)return wait('Waiting for the fixed public challenge window.',Math.max(30,Math.min(86400,assessment.challenge_until-now)));
      return send(action,`${assessment.challenges.length}:${Object.keys(assessment.findings).length}`);
    }
    if(job.kind==='monitor') {
      const [subscription]=await sql`SELECT * FROM ballast_monitoring WHERE deployment_id=${generation.id} AND agent_id=${job.target_id}`;
      if(!subscription||subscription.status==='disabled')return done();
      if(subscription.status==='pending')return wait('Waiting for operator monitoring consent to finalize.',30);
      if(job.payload.pendingOperationId) {
        const operation=await syncOperation('service:ballast:v2',job.payload.pendingOperationId);
        if(!TERMINAL_STATUSES.includes(operation.status)&&operation.status!=='error')return wait('Waiting for the monitoring assessment request to finalize.',30);
        if(operation.execution!=='success') {
          await sql`UPDATE ballast_jobs SET payload='{}'::jsonb WHERE id=${jobId}`;
          return wait('The assessment request did not execute successfully; retry remains bounded.',300);
        }
        const result=await readAt<Passport>(generation,'assurance','get_passport',[job.target_id]);
        if(!result.assessment||result.assessment.id===job.payload.previousAssessmentId)return wait('Waiting for the new assessment record.',30);
        await sql`UPDATE ballast_monitoring SET evidence_digest=${job.payload.evidenceDigest},manifest_hash=${job.payload.manifestHash},loss_count=${job.payload.lossCount},next_review_at=now()+interval '7 days',status='active',pause_reason=NULL WHERE deployment_id=${generation.id} AND agent_id=${job.target_id}`;
        await queueDomainJob('assessment',generation.id,result.assessment.id);
        await sql`UPDATE ballast_jobs SET payload='{}'::jsonb WHERE id=${jobId}`;
        return done();
      }
      const passport=await readAt<Passport>(generation,'assurance','get_passport',[job.target_id]);
      if(!passport.monitoring){await sql`UPDATE ballast_monitoring SET status='disabled' WHERE deployment_id=${generation.id} AND agent_id=${job.target_id}`;return done();}
      const agent=await readAt<{history_urls:string[];operator:string;manifest_hash:string}>(generation,'registry','get_final_agent',[job.target_id]);
      let urls=passport.assessment?.effective_evidence_urls??agent.history_urls;
      const losses=await readAt<{claims:number}>(generation,'underwriting','get_risk_record',[agent.operator]);
      if(losses.claims>0&&(subscription.loss_count===null||subscription.loss_count!==losses.claims)) {
        const pages=await Promise.all(deployments.filter(d=>d.indexed&&!d.testOnly).map(d=>readAt<{items:Claim[]}>(d,'court','list_account_claims',[agent.operator,false,-1,50])));
        urls=monitoringSources(job.target_id,urls,pages.flatMap(page=>page.items));
      }
      const evidence=await evidenceDigest(urls);
      const due=!subscription.next_review_at||Date.parse(subscription.next_review_at)<=Date.now();
      const changed=!!subscription.evidence_digest&&subscription.evidence_digest!==evidence.digest;
      const lossChanged=subscription.loss_count!==null&&subscription.loss_count!==losses.claims;
      const manifestChanged=!!subscription.manifest_hash&&subscription.manifest_hash!==agent.manifest_hash;
      await sql`UPDATE ballast_monitoring SET last_checked_at=now(),status=${evidence.complete?'active':'paused'},pause_reason=${evidence.complete?null:'Two reachable evidence hosts are required; unavailable evidence is not a negative finding.'} WHERE deployment_id=${generation.id} AND agent_id=${job.target_id}`;
      if(!evidence.complete)return done();
      if(passport.assessment&&['reviewing','challenge'].includes(passport.assessment.status)){await queueDomainJob('assessment',generation.id,passport.assessment.id);return done();}
      if((due||changed||lossChanged||manifestChanged)&&urls.length>=2) {
        if(passport.assessment&&now<passport.assessment.created_at+86400)return done();
        const operation=await sponsoredAction(`${jobId}:review:${agent.manifest_hash}:${evidence.digest}:${losses.claims}:${Math.floor(now/(7*86400))}`,{kind:'assess',agentId:job.target_id,evidenceUrls:urls.slice(0,6),publicConsent:true,deployment:generation.id});
        if(!operation){await sql`UPDATE ballast_monitoring SET status='paused',pause_reason='Sponsored transaction capacity is exhausted or a prior transaction is pending.' WHERE deployment_id=${generation.id} AND agent_id=${job.target_id}`;return wait('Waiting for sponsorship capacity.',300);}
        await sql`UPDATE ballast_jobs SET payload=${JSON.stringify({pendingOperationId:operation.id,previousAssessmentId:passport.assessment?.id,evidenceDigest:evidence.digest,manifestHash:agent.manifest_hash,lossCount:losses.claims})}::jsonb WHERE id=${jobId}`;
        return wait('Waiting for the monitoring assessment request to finalize.',30);
      }
      return done();
    }
    return done();
  }catch{
    // Provider errors can carry credentials. Persist only a bounded operational message.
    return wait('The network or sponsor configuration is unavailable. Saved transactions remain recoverable.',300);
  }
}
