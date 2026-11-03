import "server-only";
import { getOverview, read, readAt } from "./chain";
import {
  collectPages,
  type RecordKind,
  type RecordMap,
  type RecordPage,
} from "../records";
import { activeDeployment, deploymentById } from "../deployments";
import type { Agent, Claim } from "../types";
const methods = {
  agents: ["registry", "list_agents", "get_agent"],
  policies: ["underwriting", "list_policies", "get_policy"],
  claims: ["court", "list_claims", "get_claim"],
  quotes: ["underwriting", "list_quotes", "get_quote"],
} as const;
export async function lookupRecord<K extends RecordKind>(
  kind: K,
  id: string,
  deploymentId?: string,
): Promise<RecordMap[K]> {
  const [contract, , method] = methods[kind];
  const generation=deploymentById(deploymentId);
  const record=await readAt<RecordMap[K]>(generation,contract,method,[id]);
  return {...record,deployment_id:generation.id};
}
export async function publicRecordPage<K extends RecordKind>(
  kind: K,
  before?: number,
  deploymentId?: string,
): Promise<RecordPage<RecordMap[K]>> {
  const generation=deploymentById(deploymentId);
  let total:number;
  if(generation.id===activeDeployment.id){
    const overview=await getOverview();
    total={agents:overview.agentCount,claims:overview.claimCount,policies:overview.dashboard.policy_count,quotes:overview.dashboard.quote_count}[kind];
  }else{
    const contract=kind==='agents'?'registry':kind==='claims'?'court':'underwriting';
    const config=await readAt<Record<string,number>>(generation,contract,contract==='underwriting'?'get_dashboard':'get_config');
    total=Number(config[{agents:'agent_count',claims:'claim_count',policies:'policy_count',quotes:'quote_count'}[kind]]);
  }
  const end = before === undefined ? total : Math.min(before, total);
  const start = Math.max(0, end - 50);
  const [contract, method] = methods[kind];
  const records =
    end === 0
      ? []
      : await readAt<RecordMap[K][]>(generation,contract, method, [start, end - start]);
  return {
    items: records.reverse().map(record=>({...record,deployment_id:generation.id})),
    total,
    next_cursor: start > 0 ? start : null,
  };
}
export async function accountRecordPage<K extends RecordKind>(
  account: string,
  kind: K,
  before = -1,
  deploymentId?:string,
): Promise<RecordPage<RecordMap[K]>> {
  const generation=deploymentById(deploymentId);
  const at=<T>(contract:'registry'|'court'|'underwriting',method:string,args:import('genlayer-js/types').CalldataEncodable[])=>readAt<T>(generation,contract,method,args);
  if (kind === "agents")
    return at("registry", "list_operator_agents", [account, before, 50]);
  if (kind === "claims")
    return at("court", "list_account_claims", [account, false, before, 50]);
  return at("underwriting", "list_account_records", [
    account,
    kind,
    before,
    50,
  ]);
}
export async function accountCaseRecords(account: string) {
  const cases = await read<{
    claims: RecordPage<Claim>;
    unresolved: RecordPage<Claim>;
    bond_credit: string;
  }>("court", "get_account_cases", [account]);
  const unresolved = await collectPages(cases.unresolved, (cursor) =>
    read<RecordPage<Claim>>("court", "list_account_claims", [
      account,
      true,
      cursor,
      50,
    ]),
  );
  return { ...cases, unresolved };
}
export function operatorAgents(account: string) {
  return read<RecordPage<Agent>>("registry", "list_operator_agents", [
    account,
    -1,
    50,
  ]);
}
