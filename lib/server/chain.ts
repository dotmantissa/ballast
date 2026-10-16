import "server-only";
import { db } from "./db";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import {
  TransactionHashVariant,
  type CalldataEncodable,
} from "genlayer-js/types";
import deployment from "../../deployments/studio.json";
import type {
  Overview,
  Dashboard,
  Agent,
  Policy,
  Claim,
  Quote,
} from "../types";
import { jsonSafe } from "../receipt";
export const addresses = deployment;
export type ContractName = "registry" | "underwriting" | "court";
export function chainClient(key?: `0x${string}`) {
  return createClient({
    chain: studionet,
    endpoint: process.env.GENLAYER_RPC_URL,
    ...(key ? { account: createAccount(key) } : {}),
  });
}
export async function read<T>(
  contract: ContractName,
  method: string,
  args: CalldataEncodable[] = [],
): Promise<T> {
  const address = deployment[contract];
  if (!/^0x[0-9a-f]{40}$/i.test(address))
    throw Error("Contracts are not deployed");
  return jsonSafe(
    await chainClient().readContract({
      address: address as `0x${string}`,
      functionName: method,
      args,
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    }),
  ) as T;
}
let cached: Overview | undefined;
let pending: Promise<Overview> | undefined;
export async function invalidateOverview() {
  cached = undefined;
  const sql = db();
  await sql`UPDATE ballast_cache SET refresh_after=now() WHERE key='overview'`;
}
export async function getOverview(): Promise<Overview> {
  if (pending) return pending;
  pending = (async () => {
    const sql = db();
    const [entry] =
      await sql`SELECT payload,refresh_after FROM ballast_cache WHERE key='overview'`;
    if (
      entry?.payload &&
      new Date(entry.refresh_after).getTime() > Date.now()
    ) {
      cached = { ...entry.payload, stale: Date.now()-Date.parse(entry.payload.updatedAt)>120000 } as Overview;
      return cached;
    }
    const lease =
      await sql`INSERT INTO ballast_cache (key,lease_until) VALUES ('overview',now()+interval '45 seconds') ON CONFLICT(key) DO UPDATE SET lease_until=now()+interval '45 seconds' WHERE ballast_cache.lease_until<now() RETURNING key`;
    if (!lease.length) {
      if (entry?.payload) return { ...entry.payload, stale: true } as Overview;
      throw Error("The initial network read is still being prepared");
    }
    try {
      const [dashboard, registry, court] = await Promise.all([
        read<Dashboard>("underwriting", "get_dashboard"),
        read<{ agent_count: number }>("registry", "get_config"),
        read<{ claim_count: number }>("court", "get_config"),
      ]);
      const [agents, policies, claims, quotes] = await Promise.all([
        read<Agent[]>("registry", "list_agents", [
          Math.max(0, registry.agent_count - 50),
          50,
        ]),
        read<Policy[]>("underwriting", "list_policies", [
          Math.max(0, dashboard.policy_count - 50),
          50,
        ]),
        read<Claim[]>("court", "list_claims", [
          Math.max(0, court.claim_count - 50),
          50,
        ]),
        read<Quote[]>("underwriting", "list_quotes", [
          Math.max(0, dashboard.quote_count - 50),
          50,
        ]),
      ]);
      cached = {
        dashboard,
        agents: agents.reverse(),
        policies: policies.reverse(),
        claims: claims.reverse(),
        quotes: quotes.reverse(),
        agentCount: registry.agent_count,
        claimCount: court.claim_count,
        updatedAt: new Date().toISOString(),
        deployment: {
          registry: deployment.registry,
          underwriting: deployment.underwriting,
          court: deployment.court,
          network: deployment.network,
          chainId: deployment.chainId,
        },
      };
      await sql`UPDATE ballast_cache SET payload=${JSON.stringify(cached)}::jsonb,refresh_after=now()+interval '2 minutes',lease_until=now() WHERE key='overview'`;
      return cached;
    } catch (error) {
      await sql`UPDATE ballast_cache SET lease_until=now(),refresh_after=now()+interval '30 seconds' WHERE key='overview'`;
      if (entry?.payload) return { ...entry.payload, stale: true } as Overview;
      throw error;
    }
  })();
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}
