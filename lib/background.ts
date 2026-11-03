import type { Action } from "./validation";
import type { Claim } from "./types";
import { hasMutualAcceptance } from "./claims";
import { claimFindings } from "./types";
import type { Assessment } from "./assurance";
import { ASSURANCE_FIELDS } from "./assurance";
export const PILOT_AGENT_LIMIT = 10;
export const SPONSORED_DAILY_LIMIT = 20;
export const SPONSORED_ACTIONS: Action['kind'][] = ['assess','resolve_assessment','resolve_assessment_challenge','finalize_assessment','close_assessment','publish_assessment','resolve','close_unresolved','finalize','settle','acknowledge','publish_confirmation'];
export const SERVICE_ID = "service:ballast:v2";
export function nextCaseAction(claim:Claim,now:number):Action|null {
  if(["filed","reviewing"].includes(claim.status)) {
    if(now>=claim.review_deadline)return {kind:"close_unresolved",claimId:claim.id};
    const finding=claimFindings(claim).find(f=>claim.findings[f]===undefined);
    return finding?{kind:"resolve",claimId:claim.id,finding}:null;
  }
  if(claim.status==="challenge"&&(now>=claim.challenge_until||hasMutualAcceptance(claim)))return {kind:"finalize",claimId:claim.id};
  if(claim.status==="final")return {kind:"settle",claimId:claim.id};
  return null;
}
export function nextAssessmentAction(assessment:Assessment,now:number):Action|null {
  if(["reviewing","challenge"].includes(assessment.status)&&now>=assessment.review_deadline&&
    (assessment.status==="reviewing"||assessment.challenges.some(c=>c.status==="pending")))return {kind:"close_assessment",assessmentId:assessment.id};
  if(assessment.status==="reviewing") {
    const finding=ASSURANCE_FIELDS.find(f=>!assessment.findings[f]);
    return finding?{kind:"resolve_assessment",assessmentId:assessment.id,finding}:null;
  }
  if(assessment.status==="challenge") {
    const index=assessment.challenges.findIndex(c=>c.status==="pending");
    if(index>=0)return {kind:"resolve_assessment_challenge",assessmentId:assessment.id,challengeIndex:index};
    if(now>=assessment.challenge_until)return {kind:"finalize_assessment",assessmentId:assessment.id};
  }
  return null;
}

export function monitoringSources(agentId:string,base:string[],cases:Claim[]):string[] {
  const paid=cases.filter(c=>c.agent_id===agentId&&c.status==='settled'&&BigInt(c.settled_payout??'0')>0n).sort((a,b)=>b.created_at-a.created_at);
  return [...new Set([...paid.flatMap(c=>c.effective_evidence_urls),...base])].slice(0,6);
}
