"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ShieldCheck, ArrowLeft, RefreshCw, ExternalLink } from "lucide-react";
import { Logo } from "./logo";
import { ASSURANCE_FIELDS, ASSURANCE_LABELS, passportStatus, type AssuranceField, type MonitoringSubscription } from "@/lib/assurance";
import type { PassportBundle } from "@/lib/server/passports";
import type { Action } from "@/lib/validation";
import type { Account } from "@/lib/types";
import { date, gen, short } from "@/lib/format";

export function PassportDesk({agentId,deploymentId}:{agentId:string;deploymentId?:string}) {
  const {authenticated,login,getAccessToken}=usePrivy();
  const [bundle,setBundle]=useState<PassportBundle|null>(null);
  const [account,setAccount]=useState<Account|null>(null);
  const [subscription,setSubscription]=useState<MonitoringSubscription|null>(null);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [urls,setUrls]=useState("");
  const [reason,setReason]=useState("");
  const [field,setField]=useState<AssuranceField>("behavior");
  const [consent,setConsent]=useState(false);
  const [now,setNow]=useState(0);
  const suffix=deploymentId?`?deployment=${encodeURIComponent(deploymentId)}`:"";
  const authenticatedFetch=useCallback(async(path:string,init?:RequestInit)=>{
    const token=await getAccessToken();
    const response=await fetch(path,{...init,headers:{...init?.headers,Authorization:`Bearer ${token}`,"Content-Type":"application/json"}});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error??"The request could not be completed.");
    return data;
  },[getAccessToken]);
  const refresh=useCallback(async()=>{
    try {
      const response=await fetch(`/api/v2/agents/${agentId}/passport${suffix}`,{cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error??"The passport could not be reached.");
      setBundle(data);setError("");
      if(authenticated){
        const [funds,monitor]=await Promise.all([authenticatedFetch("/api/account"),authenticatedFetch(`/api/v2/monitoring?agentId=${agentId}${deploymentId?`&deployment=${encodeURIComponent(deploymentId)}`:""}`).catch(()=>null)]);
        setAccount(funds);setSubscription(monitor?.subscription??null);
      }
    }catch(e){setError(e instanceof Error?e.message:"The passport is unavailable.");}
  },[agentId,suffix,authenticated,authenticatedFetch,deploymentId]);
  useEffect(()=>{
    const timer=setTimeout(()=>{setNow(Date.now()/1000);void refresh();},0);
    const interval=setInterval(()=>{setNow(Date.now()/1000);void refresh();},30000);
    return()=>{clearTimeout(timer);clearInterval(interval);};
  },[refresh]);
  async function act(action:Action){
    if(!authenticated){login();return;}
    setBusy(true);setNotice("");
    try{
      const operation=await authenticatedFetch("/api/actions",{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({...action,deployment:bundle?.deployment.id})});
      setNotice(`Submitted. Follow transaction ${operation.tx_hash?short(operation.tx_hash,10):operation.id} in your account activity. Background review continues after you leave.`);
      await refresh();
    }catch(e){setNotice(e instanceof Error?e.message:"Submission failed.");}finally{setBusy(false);}
  }
  const passport=bundle?.passport;
  const assessment=passport?.assessment;
  const owner=authenticated&&!!account&&bundle?.agent.operator.toLowerCase()===account.address.toLowerCase();
  const evidence=urls.split(/\n/).map(u=>u.trim()).filter(Boolean);
  const evidenceActionReady=consent&&evidence.length>=2&&!busy;
  const challengeOpen=assessment?.status==="challenge"&&now>0&&now<assessment.challenge_until;
  const canRequest=!assessment||["final","disputed","evidence_timeout"].includes(assessment.status);
  return <main className="passport-page">
    <header className="passport-header"><Link href="/" aria-label="Ballast home"><Logo/></Link><Link className="text-button" href="/"><ArrowLeft size={16}/> Back to Ballast</Link></header>
    <div className="section-heading"><div><p className="eyebrow">Agent trust passport</p><h1>{bundle?.agent.name??"Agent passport"}</h1><p>Independent GenLayer findings, public evidence, and the history behind future cover.</p></div><button className="button secondary small" onClick={()=>void refresh()}><RefreshCw size={16}/> Refresh</button></div>
    {error?<p className="notice" role="alert">{error}</p>:null}
    {notice?<p className="notice" role="status">{notice}</p>:null}
    {!bundle&&!error?<p role="status">Reading the agent’s public records…</p>:null}
    {bundle?<>
      {bundle.deployment.testOnly?<p className="notice">Isolated Studio validation. This passport cannot authorize new production cover.</p>:null}
      <section className="reserve-panel passport-summary"><div><ShieldCheck size={28}/><h2>{passportStatus(passport??null,now)}</h2><p>{passport?.ready?"A fresh finalized assessment is available for underwriting.":"New cover requires a complete, fresh, finalized assessment."}</p>{bundle.stale?<p role="status">The network is unavailable. This saved passport cannot authorize new cover.</p>:null}</div><dl><dt>Executor</dt><dd className="mono">{bundle.agent.executor_address}</dd><dt>Operator</dt><dd className="mono">{bundle.agent.operator}</dd><dt>Manifest revision hash</dt><dd className="mono">{bundle.agent.manifest_hash}</dd><dt>Generation</dt><dd>{bundle.deployment.label}</dd><dt>Last network read</dt><dd>{new Date(bundle.updatedAt).toLocaleString()}</dd></dl></section>
      <section className="passport-findings" aria-label="GenLayer assessment findings">{ASSURANCE_FIELDS.map(f=><article className="reserve-panel" key={f}><p className="eyebrow">{ASSURANCE_LABELS[f]}</p><h2>{assessment?.findings[f]??"Awaiting assessment"}</h2><p>{assessment?.reasons[f]??"Evidence must establish this finding. Missing history is not a clean record."}</p>{assessment?.status==="reviewing"&&!assessment.findings[f]?<button disabled={busy} className="button secondary small" onClick={()=>void act({kind:"resolve_assessment",assessmentId:assessment.id,finding:f})}>Request this finding</button>:null}</article>)}</section>
      {assessment?<section className="reserve-panel"><h2>Assessment timeline</h2><dl className="passport-timeline"><dt>Revision</dt><dd>{assessment.revision} · {assessment.rubric_version}</dd><dt>Requested</dt><dd>{date(assessment.created_at)}</dd><dt>Evidence freshness ends</dt><dd>{date(assessment.valid_until)}</dd><dt>Review deadline</dt><dd>{date(assessment.review_deadline)}</dd>{assessment.challenge_until?<><dt>Public challenge closes</dt><dd>{date(assessment.challenge_until)}</dd></>:null}</dl><div className="inline-actions">{assessment.status==="challenge"&&now>=assessment.challenge_until&&!assessment.challenges.some(c=>c.status==="pending")?<button className="button primary small" disabled={busy} onClick={()=>void act({kind:"finalize_assessment",assessmentId:assessment.id})}>Finalize assessment</button>:null}{assessment.status==="final"&&!passport?.ready?<button className="button secondary small" disabled={busy} onClick={()=>void act({kind:"publish_assessment",assessmentId:assessment.id})}>Refresh finality confirmation</button>:null}{now>=assessment.review_deadline&&(assessment.status==="reviewing"||(assessment.status==="challenge"&&assessment.challenges.some(c=>c.status==="pending")))?<button className="button secondary small" disabled={busy} onClick={()=>void act({kind:"close_assessment",assessmentId:assessment.id})}>Close overdue review and refund pending bonds</button>:null}</div>
        {assessment.challenges.map((c,i)=><article className="passport-challenge" key={`${c.field}:${c.kind}`}><strong>{ASSURANCE_LABELS[c.field]} · {c.kind} challenge · {c.status}</strong><p>{c.reason}</p><p className="mono">{short(c.by,10)} · {gen(c.bond)} GEN bond</p>{c.status==="pending"&&now<assessment.review_deadline?<button className="button secondary small" disabled={busy} onClick={()=>void act({kind:"resolve_assessment_challenge",assessmentId:assessment.id,challengeIndex:i})}>Resolve challenge</button>:null}</article>)}
      </section>:null}
      <section className="reserve-panel"><h2>Public evidence</h2><p>Validators fetch sources independently. A source digest records what was read; hosting the same claim on two sites does not make it independently verified.</p><ul>{(assessment?.effective_evidence_urls??bundle.agent.history_urls).map(url=><li key={url}><a href={url} target="_blank" rel="noreferrer">{url} <ExternalLink size={12}/></a></li>)}</ul><details><summary>Declared scope and original manifest</summary><p>{bundle.agent.scope}</p><pre>{bundle.agent.manifest}</pre></details></section>
      <section className="reserve-panel"><h2>Verified loss history</h2><p>Paid losses and settled cases stay visible across contract generations. Unavailable records remain unknown.</p>{bundle.history.map(h=><div className="passport-history" key={h.deployment}><strong>{h.label}</strong><span>{!h.available?"Unavailable":!h.confirmed?"Earlier record — no finalized proof interface":`${h.claims} paid claims · ${h.settled_claims} settled cases · ${gen(h.paid)} GEN paid`}</span></div>)}</section>
      {bundle.deployment.assurance?<section className="reserve-panel"><h2>{owner?"Manage assurance":"Challenge an assessment"}</h2>{!authenticated?<button className="button primary" onClick={login}>Sign in with email</button>:null}
        {owner?<div className="passport-monitor"><h3>Sponsored monitoring</h3><p>Daily evidence checks, weekly and event-driven GenLayer reviews. Existing policy promises stay fixed. Premiums and bonds require your own submission.</p><button disabled={busy} className="button secondary" onClick={()=>void act({kind:"monitor",agentId,enabled:!passport?.monitoring})}>{passport?.monitoring?"Disable monitoring":"Enable monitoring"}</button>{subscription?<p role="status">{subscription.status}{subscription.pause_reason?`: ${subscription.pause_reason}`:""}{subscription.last_checked_at?` · checked ${new Date(subscription.last_checked_at).toLocaleString()}`:""}</p>:null}</div>:null}
        {(owner&&canRequest)||challengeOpen?<form onSubmit={e=>{e.preventDefault();if(!evidenceActionReady)return;if(owner&&canRequest)void act({kind:"assess",agentId,evidenceUrls:evidence,publicConsent:true});else if(assessment)void act({kind:"challenge_assessment",assessmentId:assessment.id,finding:field,reason,evidenceUrls:evidence,publicConsent:true});}}>
          {challengeOpen?<><label htmlFor="passport-finding">Finding to challenge</label><select id="passport-finding" value={field} onChange={e=>setField(e.target.value as AssuranceField)}>{ASSURANCE_FIELDS.map(f=><option value={f} key={f}>{ASSURANCE_LABELS[f]}</option>)}</select><label htmlFor="passport-reason">Evidence-backed explanation</label><textarea id="passport-reason" minLength={40} maxLength={4000} required value={reason} onChange={e=>setReason(e.target.value)}/><p>One public challenge and one operator appeal per finding. Each requires a 0.01 GEN bond; the deadline is fixed.</p></>:null}
          <label htmlFor="passport-evidence">Public evidence URLs, one per line, from at least two hosts</label><textarea id="passport-evidence" required value={urls} onChange={e=>setUrls(e.target.value)} placeholder="https://…"/>
          <label className="check-label"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> I understand that the evidence and explanation will be public.</label><button className="button primary" disabled={!evidenceActionReady||!authenticated}>{owner&&canRequest?"Request GenLayer assessment":"Submit bonded challenge"}</button>
        </form>:null}
        {BigInt(account?.assuranceBondCredit??"0")>0n?<button className="button secondary" disabled={busy} onClick={()=>void act({kind:"withdraw_assurance_bonds"})}>Withdraw {gen(account?.assuranceBondCredit)} GEN assurance bond credit</button>:null}
      </section>:<p className="notice">This earlier generation predates GenLayer passports. Register this executor in v2 to request a new assessment.</p>}
      <details className="reserve-panel"><summary>Verification and integration</summary><p>Read the <a href={`/api/v2/agents/${agentId}/passport${suffix}`}>versioned passport API</a> or <a href={`/api/v2/agents/${agentId}/assessments${suffix}`}>assessment history</a>. Assessment reasons and source digests remain inspectable on the assurance contract.</p>{bundle.deployment.assurance?<a href={`https://explorer-studio.genlayer.com/address/${bundle.deployment.assurance}`} target="_blank" rel="noreferrer">Assurance contract <ExternalLink size={14}/></a>:null}</details>
    </>:null}
  </main>;
}
