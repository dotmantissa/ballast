import { authenticate, apiError } from "@/lib/server/auth";
import { getAccount } from "@/lib/server/accounts";
import { read, chainClient } from "@/lib/server/chain";
import { getOperations } from "@/lib/server/operations";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await authenticate(request);
    const account = await getAccount(user);
    const [funds, bonds, balance, operations] = await Promise.all([
      read<Record<string, string>>("underwriting", "get_account", [
        account.address,
      ]),
      read<string>("court", "get_bond_credit", [account.address]),
      chainClient().getBalance({ address: account.address }),
      getOperations(user.id),
    ]);
    return Response.json(
      {
        ...funds,
        email: user.email,
        address: account.address,
        balance: balance.toString(),
        bondCredit: bonds,
        operations,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
