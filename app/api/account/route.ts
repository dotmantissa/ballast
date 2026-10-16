import { authenticate, apiError } from "@/lib/server/auth";
import { getAccount } from "@/lib/server/accounts";
import { read, chainClient, addresses } from "@/lib/server/chain";
import { accountCaseRecords, operatorAgents } from "@/lib/server/records";
import type { RecordPage } from "@/lib/records";
import type { Policy, Quote } from "@/lib/types";
import { legacyCapital } from "@/lib/server/legacy-capital";
import { getOperations } from "@/lib/server/operations";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await authenticate(request);
    const account = await getAccount(user);
    const [funds, cases, agents, balance, operations, legacy] = await Promise.all([
      read<
        Record<string, string> & {
          policies: RecordPage<Policy>;
          quotes: RecordPage<Quote>;
        }
      >("underwriting", "get_account", [account.address]),
      accountCaseRecords(account.address),
      operatorAgents(account.address),
      chainClient().getBalance({ address: account.address }),
      getOperations(user.id),
      legacyCapital(account.address),
    ]);
    return Response.json(
      {
        ...funds,
        legacyCapital: legacy,
        deployment: {
          court: addresses.court,
          underwriting: addresses.underwriting,
        },
        email: user.email,
        address: account.address,
        balance: balance.toString(),
        bondCredit: cases.bond_credit,
        records: {
          agents,
          policies: funds.policies,
          quotes: funds.quotes,
          claims: cases.claims,
        },
        unresolvedClaims: cases.unresolved,
        operations,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
