import "server-only";
import { TransactionHashVariant } from "genlayer-js/types";
import { chainClient, addresses } from "./chain";
import previous from "../../deployments/previous-studio.json";
import type { LegacyCapital } from "../types";
import { jsonSafe } from "../receipt";
export const previousPool = previous.underwriting as `0x${string}`;
export async function legacyCapital(account: string): Promise<LegacyCapital | null> {
  if (previousPool.toLowerCase() === addresses.underwriting.toLowerCase()) return null;
  try {
    const funds = jsonSafe(await chainClient().readContract({address:previousPool,functionName:"get_account",args:[account],transactionHashVariant:TransactionHashVariant.LATEST_FINAL})) as Record<string,string>;
    return {address:previousPool,available:true,junior_shares:funds.junior_shares,senior_shares:funds.senior_shares,junior_value:funds.junior_value,senior_value:funds.senior_value,credit:funds.credit};
  } catch { return {address:previousPool,available:false}; }
}
