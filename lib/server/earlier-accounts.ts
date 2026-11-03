import "server-only";
import { deployments, activeDeployment } from "../deployments";
import { readAt } from "./chain";
import { collectPages, type RecordPage } from "../records";
import type { EarlierAccount, Claim, Policy, LegacyCapital } from "../types";

export async function earlierAccounts(address:string):Promise<EarlierAccount[]> {
  return Promise.all(deployments.filter(d=>d.id!==activeDeployment.id).map(async deployment=>{
    const capital:LegacyCapital={address:deployment.underwriting,deployment_id:deployment.id,available:false};
    try {
      const funds=await readAt<LegacyCapital & {policies?:RecordPage<Policy>}>(deployment,"underwriting","get_account",[address]);
      Object.assign(capital,funds,{address:deployment.underwriting,available:true});
      const claims=deployment.indexed?await readAt<{unresolved:RecordPage<Claim>;bond_credit:string}>(deployment,"court","get_account_cases",[address]):null;
      const unresolved=claims?await collectPages(claims.unresolved,cursor=>readAt<RecordPage<Claim>>(deployment,"court","list_account_claims",[address,true,cursor,50])):[];
      const policies=funds.policies?await collectPages(funds.policies,cursor=>readAt<RecordPage<Policy>>(deployment,"underwriting","list_account_records",[address,"policies",cursor,50])):[];
      return {deployment,capital,claims:unresolved.map(c=>({...c,deployment_id:deployment.id})),policies:policies.map(p=>({...p,deployment_id:deployment.id})),bondCredit:claims?.bond_credit??"0",available:true};
    } catch {return {deployment,capital,claims:[],policies:[],bondCredit:"0",available:false};}
  }));
}
