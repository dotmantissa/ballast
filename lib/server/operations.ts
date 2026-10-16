import "server-only";
import { randomUUID } from "node:crypto";
import { parseUnits } from "viem";
import type { CalldataEncodable } from "genlayer-js/types";
import { db } from "./db";
import { getAccount, rateLimit } from "./accounts";
import { HttpError } from "./auth";
import {
  addresses,
  chainClient,
  read,
  invalidateOverview,
  type ContractName,
} from "./chain";
import { inspectReceipt } from "../receipt";
import type { Action } from "../validation";
import type { Quote, Claim, Operation } from "../types";

export async function submitAction(
  user: { id: string; email: string },
  action: Action,
  idempotencyKey: string,
) {
  const sql = db();
  const account = await getAccount(user);
  const [prior] =
    await sql`SELECT id,tx_hash,status FROM ballast_operations WHERE user_id=${user.id} AND idempotency_key=${idempotencyKey}`;
  if (prior) return prior;
  if (!(await rateLimit(user.id)))
    throw new HttpError(
      429,
      "A little breathing room, please. Try again in a minute.",
    );
  const id = randomUUID();
  const locked =
    await sql`UPDATE ballast_accounts SET submit_lock=${id},submit_lock_at=now() WHERE privy_id=${user.id} AND (submit_lock IS NULL OR submit_lock_at<now()-interval '2 minutes') RETURNING address`;
  if (!locked.length)
    throw new HttpError(
      409,
      "Another action is being submitted. Give it a moment.",
    );
  let submitting = false;
  try {
    const inserted =
      await sql`INSERT INTO ballast_operations (id,user_id,idempotency_key,kind) VALUES (${id},${user.id},${idempotencyKey},${action.kind}) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id`;
    if (!inserted.length) {
      const [row] =
        await sql`SELECT id,tx_hash,status FROM ballast_operations WHERE user_id=${user.id} AND idempotency_key=${idempotencyKey}`;
      return row;
    }
    const client = chainClient(account.key());
    if (action.kind === "faucet") {
      const funded =
        await sql`UPDATE ballast_accounts SET faucet_at=now() WHERE privy_id=${user.id} AND (faucet_at IS NULL OR faucet_at<now()-interval '24 hours') RETURNING address`;
      if (!funded.length)
        throw new HttpError(
          429,
          "Test funds are available once every 24 hours.",
        );
      submitting = true;
      await client.request({
        method: "sim_fundAccount",
        params: [account.address, 25 * 10 ** 18],
      });
      await sql`UPDATE ballast_operations SET status='FINALIZED',execution='success',updated_at=now() WHERE id=${id}`;
      return { id, status: "FINALIZED", tx_hash: null };
    }
    let contract: ContractName = "underwriting";
    let method = "";
    let args: CalldataEncodable[] = [];
    let value = 0n;
    switch (action.kind) {
      case "register":
        contract = "registry";
        method = "register_agent";
        args = [action.manifest, action.historyUrls];
        break;
      case "quote":
        method = "quote_policy";
        args = [action.agentId, parseUnits(action.limit, 18), action.peerUrls];
        break;
      case "bind": {
        const quote = await read<Quote>("underwriting", "get_quote", [
          action.quoteId,
        ]);
        if (quote.operator.toLowerCase() !== account.address.toLowerCase())
          throw new HttpError(403, "This quote belongs to another operator.");
        method = "bind_policy";
        args = [action.quoteId];
        value = BigInt(quote.premium);
        break;
      }
      case "stake":
        method = "stake";
        args = [action.tranche];
        value = parseUnits(action.amount, 18);
        break;
      case "redeem":
        method = "redeem";
        args = [action.tranche, BigInt(action.shares)];
        break;
      case "withdraw":
        method = "withdraw";
        break;
      case "withdraw_bonds":
        contract = "court";
        method = "withdraw_bonds";
        break;
      case "claim":
        contract = "court";
        method = "file_claim";
        args = [
          action.policyId,
          action.incidentRef,
          action.incidentAt,
          parseUnits(action.amount, 18),
          action.statement,
          action.evidenceUrls,
        ];
        value = parseUnits(action.amount, 18) / 100n;
        if (value < 10n ** 16n) value = 10n ** 16n;
        break;
      case "resolve":
        contract = "court";
        method = "resolve_finding";
        args = [action.claimId, action.finding];
        break;
      case "appeal": {
        const claim = await read<Claim>("court", "get_claim", [action.claimId]);
        if (
          ![
            claim.claimant.toLowerCase(),
            claim.operator.toLowerCase(),
          ].includes(account.address.toLowerCase())
        )
          throw new HttpError(403, "Only the claimant or operator can appeal.");
        contract = "court";
        method = "appeal_finding";
        args = [
          action.claimId,
          action.finding,
          action.reason,
          action.evidenceUrls,
        ];
        value = BigInt(claim.amount) / 100n;
        if (value < 10n ** 16n) value = 10n ** 16n;
        break;
      }
      case "finalize":
        contract = "court";
        method = "finalize_claim";
        args = [action.claimId];
        break;
      case "settle":
        method = "settle_claim";
        args = [action.claimId];
        break;
      case "sync_loss":
        contract = "registry";
        method = "sync_loss";
        args = [action.claimId];
        break;
      case "expire":
        method = "expire_policy";
        args = [action.policyId];
        break;
    }
    const balance = await client.getBalance({ address: account.address });
    if (balance < value)
      throw new HttpError(
        400,
        "There are not enough test funds for this action. Add test funds from your account menu.",
      );
    const nonce = await client.getCurrentNonce({ address: account.address });
    await sql`UPDATE ballast_operations SET nonce=${nonce},status='submitting',updated_at=now() WHERE id=${id}`;
    submitting = true;
    const hash = await client.writeContract({
      address: addresses[contract] as `0x${string}`,
      functionName: method,
      args,
      value,
      leaderOnly: false,
    });
    await sql`UPDATE ballast_operations SET tx_hash=${hash},status='PENDING',updated_at=now() WHERE id=${id}`;
    return { id, tx_hash: hash, status: "PENDING" };
  } catch (error) {
    const message =
      error instanceof HttpError
        ? error.message
        : submitting
          ? "Submission could not be confirmed. Please do not repeat this action until its network status is checked."
          : "The action could not be prepared. Please try again.";
    await sql`UPDATE ballast_operations SET status=${submitting ? "uncertain" : "error"},execution=${submitting ? "pending" : "error"},error=${message},updated_at=now() WHERE id=${id}`;
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, message);
  } finally {
    await sql`UPDATE ballast_accounts SET submit_lock=NULL,submit_lock_at=NULL WHERE privy_id=${user.id} AND submit_lock=${id}`;
  }
}

export async function getOperations(userId: string): Promise<Operation[]> {
  const sql = db();
  return (await sql`SELECT id,kind,status,tx_hash,execution,error,created_at,votes FROM ballast_operations WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 25`) as Operation[];
}
export async function syncOperation(userId: string, id: string) {
  const sql = db();
  const [row] =
    await sql`SELECT * FROM ballast_operations WHERE user_id=${userId} AND id=${id}`;
  if (!row) throw new HttpError(404, "Activity not found.");
  if (
    !row.tx_hash ||
    [
      "FINALIZED",
      "CANCELED",
      "UNDETERMINED",
      "LEADER_TIMEOUT",
      "VALIDATORS_TIMEOUT",
    ].includes(row.status)
  )
    return row;
  if (Date.now() - new Date(row.updated_at).getTime() < 8000) return row;
  const receipt = await chainClient().getTransaction({ hash: row.tx_hash });
  const result = inspectReceipt(receipt);
  await sql`UPDATE ballast_operations SET status=${result.status},execution=${result.execution},error=${result.error ?? null},votes=${JSON.stringify(result.votes)}::jsonb,updated_at=now() WHERE id=${id}`;
  if (result.status === "FINALIZED" && result.execution === "success")
    await invalidateOverview();
  return {
    ...row,
    status: result.status,
    execution: result.execution,
    error: result.error ?? null,
    votes: result.votes,
  };
}
