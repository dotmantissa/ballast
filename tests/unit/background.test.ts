import { describe, expect, it } from "vitest";
import { nextAssessmentAction, nextCaseAction, monitoringSources } from "../../lib/background";
import { passportStatus, type Assessment, type Passport } from "../../lib/assurance";
import { claimFindings, type Claim } from "../../lib/types";
import { deploymentById, activeDeployment, deployments } from "../../lib/deployments";
const claim=(values:Partial<Claim>)=>({id:'a'.repeat(24),status:'reviewing',claimant:'0x'+'1'.repeat(40),operator:'0x'+'2'.repeat(40),review_deadline:1000,challenge_until:2000,findings:{},acceptances:[],appeals:[],...values}) as Claim;
const assessment=(values:Partial<Assessment>)=>({id:'b'.repeat(24),status:'reviewing',claimant:'0x'+'1'.repeat(40),operator:'0x'+'2'.repeat(40),review_deadline:1000,challenge_until:2000,findings:{},challenges:[],...values}) as Assessment;
describe('permissionless progression',()=>{
  it('uses three independent v2 facts and preserves the fourth v1 finding',()=>{
    const facts={harm:true,causation:true,scope:true};
    expect(nextCaseAction(claim({findings:facts}),100)).toMatchObject({kind:'resolve',finding:'payout'});
    expect(nextCaseAction(claim({findings:facts,peril_version:'unauthorized-debit-v2'}),100)).toBeNull();
    expect(claimFindings(claim({peril_version:'unauthorized-debit-v2'}))).toHaveLength(3);
  });
  it('closes unresolved cases at the exact deadline and waits for challenges',()=>{
    expect(nextCaseAction(claim({}),1000)).toMatchObject({kind:'close_unresolved'});
    expect(nextCaseAction(claim({status:'challenge'}),1999)).toBeNull();
    expect(nextCaseAction(claim({status:'challenge'}),2000)).toMatchObject({kind:'finalize'});
    expect(nextCaseAction(claim({status:'final'}),2000)).toMatchObject({kind:'settle'});
    expect(nextCaseAction(claim({status:'settled'}),2000)).toBeNull();
  });
  it('judges a pending bonded challenge before attempting finalization',()=>{
    const pending=assessment({status:'challenge',review_deadline:3000,challenges:[{status:'pending'} as Assessment['challenges'][number]]});
    expect(nextAssessmentAction(pending,2001)).toMatchObject({kind:'resolve_assessment_challenge',challengeIndex:0});
    expect(nextAssessmentAction(pending,3000)).toMatchObject({kind:'close_assessment'});
    expect(nextAssessmentAction(assessment({status:'challenge',review_deadline:3000}),2000)).toMatchObject({kind:'finalize_assessment'});
  });
  it('distinguishes expired, disputed, absent and unconfirmed passports',()=>{
    const passport=(a:Assessment,ready=false)=>({assessment:a,ready}) as Passport;
    expect(passportStatus(null,100)).toBe('Unassessed');
    expect(passportStatus(passport(assessment({status:'disputed'})),100)).toBe('Disputed');
    expect(passportStatus(passport(assessment({status:'final',valid_until:100}),true),100)).toBe('Stale');
    expect(passportStatus(passport(assessment({status:'final',valid_until:200})),100)).toBe('Confirmation pending');
  });
});
describe('deployment allowlist',()=>{
  it('resolves the current deployment and every preserved generation',()=>{
    expect(deploymentById()).toEqual(activeDeployment);
    for(const generation of deployments)expect(deploymentById(generation.id)).toEqual(generation);
    expect(deployments.map(d=>d.id)).toEqual(expect.arrayContaining(['v1-review','v1-original']));
  });
  it('rejects an arbitrary address or unrecognized generation',()=>{
    expect(()=>deploymentById('0x'+'1'.repeat(40))).toThrow('Unknown deployment');
    expect(()=>deploymentById('unlisted')).toThrow('Unknown deployment');
  });
});

it('uses incident evidence from paid finalized losses in event-triggered monitoring',()=>{
  const sources=monitoringSources('agent',['https://history.example/a','https://explorer.example/old'],[
    claim({agent_id:'agent',status:'settled',settled_payout:'10',created_at:20,effective_evidence_urls:['https://explorer.example/loss','https://case.example/loss']}),
    claim({agent_id:'other',status:'settled',settled_payout:'10',created_at:30,effective_evidence_urls:['https://other.example/loss']}),
    claim({agent_id:'agent',status:'final',settled_payout:'10',created_at:40,effective_evidence_urls:['https://pending.example/loss']}),
    claim({agent_id:'agent',status:'settled',settled_payout:'0',created_at:50,effective_evidence_urls:['https://zero.example/case']})]);
  expect(sources).toEqual(['https://explorer.example/loss','https://case.example/loss','https://history.example/a','https://explorer.example/old']);
});
