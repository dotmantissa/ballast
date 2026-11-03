import "server-only";
import { activeDeployment, deployments, type Deployment } from "../deployments";
import type { Agent } from "../types";
import type { Passport } from "../assurance";
import { db } from "./db";
import { readAt } from "./chain";

export type PassportBundle = {
  agent: Agent;
  passport: Passport | null;
  deployment: Deployment;
  updatedAt: string;
  stale: boolean;
  history: { deployment: string; label: string; available: boolean; confirmed: boolean; claims?: number; settled_claims?: number; paid?: string }[];
};

export async function getPassportBundle(agentId: string, deployment = activeDeployment): Promise<PassportBundle> {
  const sql = db();
  const key = `passport:${deployment.id}:${agentId}`;
  const [cached] = await sql`SELECT payload,refresh_after FROM ballast_cache WHERE key=${key}`;
  const normalize = (bundle: PassportBundle, stale: boolean): PassportBundle => ({
    ...bundle, stale,
    passport: bundle.passport ? {
      ...bundle.passport,
      ready: !stale && bundle.passport.ready && (bundle.passport.final_assessment?.valid_until ?? 0) > Date.now()/1000,
    } : null,
  });
  if (cached?.payload && Date.parse(cached.refresh_after) > Date.now()) return normalize(cached.payload, false);
  try {
    const [agent, passport] = await Promise.all([
      readAt<Agent>(deployment, "registry", "get_final_agent", [agentId]),
      deployment.assurance ? readAt<Passport>(deployment, "assurance", "get_passport", [agentId]) : Promise.resolve(null),
    ]);
    const history = await Promise.all(deployments.map(async (generation) => {
      try {
        const record = await readAt<{claims:number;settled_claims:number;paid:string}>(generation, "underwriting", generation.indexed ? "get_final_operator_record" : "get_operator_record", [agent.operator]);
        return {deployment:generation.id,label:generation.label,available:true,confirmed:generation.indexed,...record};
      } catch { return {deployment:generation.id,label:generation.label,available:false,confirmed:false}; }
    }));
    const bundle: PassportBundle = {agent,passport,deployment,history,stale:false,updatedAt:new Date().toISOString()};
    await sql`INSERT INTO ballast_cache(key,payload,refresh_after) VALUES(${key},${JSON.stringify(bundle)}::jsonb,now()+interval '2 minutes') ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,refresh_after=excluded.refresh_after`;
    return normalize(bundle,false);
  } catch (error) {
    if (cached?.payload) return normalize(cached.payload,true);
    throw error;
  }
}
