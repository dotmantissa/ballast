import "server-only";
import { getOverview, read } from "./chain";
import {
  collectPages,
  type RecordKind,
  type RecordMap,
  type RecordPage,
} from "../records";
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
): Promise<RecordMap[K]> {
  const [contract, , method] = methods[kind];
  return read<RecordMap[K]>(contract, method, [id]);
}
export async function publicRecordPage<K extends RecordKind>(
  kind: K,
  before?: number,
): Promise<RecordPage<RecordMap[K]>> {
  const overview = await getOverview();
  const counts = {
    agents: overview.agentCount,
    claims: overview.claimCount,
    policies: overview.dashboard.policy_count,
    quotes: overview.dashboard.quote_count,
  };
  const total = counts[kind];
  const end = before === undefined ? total : Math.min(before, total);
  const start = Math.max(0, end - 50);
  const [contract, method] = methods[kind];
  const records =
    end === 0
      ? []
      : await read<RecordMap[K][]>(contract, method, [start, end - start]);
  return {
    items: records.reverse(),
    total,
    next_cursor: start > 0 ? start : null,
  };
}
export async function accountRecordPage<K extends RecordKind>(
  account: string,
  kind: K,
  before = -1,
): Promise<RecordPage<RecordMap[K]>> {
  if (kind === "agents")
    return read("registry", "list_operator_agents", [account, before, 50]);
  if (kind === "claims")
    return read("court", "list_account_claims", [account, false, before, 50]);
  return read("underwriting", "list_account_records", [
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
