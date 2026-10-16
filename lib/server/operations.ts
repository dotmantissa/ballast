import "server-only";
import { randomUUID, createHash } from "node:crypto";
import {
  parseUnits,
  keccak256,
  parseTransaction,
  parseEventLogs,
  parseAbi,
} from "viem";
import { encryptKey, decryptPayload } from "../custody";
import { env } from "./env";
import {
  recoveryState,
  retryDelay,
  operationView,
  TERMINAL_STATUSES,
  operationRow,
} from "../operation-recovery";
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

function publicOperation(row: Record<string, unknown>) {
  return operationView(operationRow(row));
}
function savedState(row: Record<string, unknown>) {
  return recoveryState(operationRow(row));
}

export async function submitAction(
  user: { id: string; email: string },
  action: Action,
  idempotencyKey: string,
) {
  const sql = db();
  const account = await getAccount(user);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ deployment: addresses.underwriting, action }))
    .digest("hex");
  let [prior] =
    await sql`SELECT * FROM ballast_operations WHERE user_id=${user.id} AND idempotency_key=${idempotencyKey}`;
  if (prior && prior.action_hash !== fingerprint)
    throw new HttpError(
      409,
      "This submission key belongs to a different action or deployment.",
    );
  if (prior && savedState(prior) === "reconcile") {
    await syncOperation(user.id, prior.id);
    [prior] = await sql`SELECT * FROM ballast_operations WHERE id=${prior.id}`;
  }
  if (
    prior &&
    (savedState(prior) !== "retry" ||
      (prior.next_retry_at &&
        new Date(prior.next_retry_at).getTime() > Date.now()))
  )
    return publicOperation(prior);
  if (!(await rateLimit(user.id)))
    throw new HttpError(
      429,
      "A little breathing room, please. Try again in a minute.",
    );
  const id = prior?.id ?? randomUUID();
  const lease = randomUUID();
  const locked =
    await sql`UPDATE ballast_accounts SET submit_lock=${lease},submit_lock_at=now() WHERE privy_id=${user.id} AND (submit_lock IS NULL OR submit_lock_at<now()-interval '2 minutes') RETURNING address`;
  if (!locked.length)
    throw new HttpError(
      409,
      "Another action is being submitted. Give it a moment.",
    );
  let signed = false;
  let faucetStarted = false;
  let attempt = 1;
  try {
    const unknown =
      await sql`SELECT id FROM ballast_operations WHERE user_id=${user.id} AND id<>${id} AND kind<>'faucet' AND status IN ('signed','uncertain') LIMIT 1`;
    if (unknown.length)
      throw new HttpError(
        409,
        "A previous submission is still being checked. Open its activity before sending another action.",
      );
    [prior] =
      await sql`SELECT * FROM ballast_operations WHERE user_id=${user.id} AND idempotency_key=${idempotencyKey}`;
    if (prior) {
      if (prior.action_hash !== fingerprint)
        throw new HttpError(
          409,
          "This submission key belongs to a different action.",
        );
      if (
        savedState(prior) !== "retry" ||
        (prior.next_retry_at &&
          new Date(prior.next_retry_at).getTime() > Date.now())
      )
        return publicOperation(prior);
      attempt = Number(prior.attempt) + 1;
      await sql.transaction([
        sql`INSERT INTO ballast_operation_attempts(operation_id,attempt,status,execution,tx_hash,evm_hash,error) SELECT id,attempt,status,execution,tx_hash,evm_hash,error FROM ballast_operations WHERE id=${id} ON CONFLICT DO NOTHING`,
        sql`UPDATE ballast_operations SET attempt=${attempt},status='preparing',execution='pending',tx_hash=NULL,evm_hash=NULL,signed_payload=NULL,nonce=NULL,error=NULL,next_retry_at=NULL,votes='[]',updated_at=now() WHERE id=${id}`,
      ]);
    } else {
      await sql`INSERT INTO ballast_operations(id,user_id,idempotency_key,kind,action_hash) VALUES (${id},${user.id},${idempotencyKey},${action.kind},${fingerprint})`;
    }
    const client = chainClient(account.key(), async (raw) => {
      const hash = keccak256(raw);
      const payload = encryptKey(
        raw,
        env("CUSTODY_MASTER_KEY"),
        user.id + ":" + id + ":" + attempt,
      );
      const nonce = parseTransaction(raw).nonce ?? 0;
      const saved =
        await sql`UPDATE ballast_operations SET signed_payload=${payload},evm_hash=${hash},nonce=${nonce},status='signed',updated_at=now() WHERE id=${id} AND attempt=${attempt} AND status IN ('preparing','submitting','signed') AND (evm_hash IS NULL OR evm_hash=${hash}) AND EXISTS(SELECT 1 FROM ballast_accounts WHERE privy_id=${user.id} AND submit_lock=${lease}) RETURNING id`;
      if (!saved.length)
        throw new HttpError(
          409,
          "This submission lease changed before broadcast. Its saved activity will be reconciled.",
        );
      signed = true;
    });
    if (action.kind === "faucet") {
      const funded =
        await sql`UPDATE ballast_accounts SET faucet_at=now() WHERE privy_id=${user.id} AND (faucet_at IS NULL OR faucet_at<now()-interval '24 hours') RETURNING address`;
      if (!funded.length)
        throw new HttpError(
          429,
          "Test funds are available once every 24 hours.",
        );
      faucetStarted = true;
      await client.request({
        method: "sim_fundAccount",
        params: [account.address, 25 * 10 ** 18],
      });
      await sql`UPDATE ballast_operations SET status='FINALIZED',execution='success',updated_at=now() WHERE id=${id}`;
      const [row] = await sql`SELECT * FROM ballast_operations WHERE id=${id}`;
      return publicOperation(row);
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
    await sql`UPDATE ballast_operations SET status='submitting',updated_at=now() WHERE id=${id} AND attempt=${attempt}`;
    const hash = await client.writeContract({
      address: addresses[contract] as `0x${string}`,
      functionName: method,
      args,
      value,
      leaderOnly: false,
    });
    await sql`UPDATE ballast_operations SET tx_hash=${hash},status='PENDING',updated_at=now() WHERE id=${id} AND attempt=${attempt} AND status NOT IN ('FINALIZED','CANCELED')`;
    const [row] = await sql`SELECT * FROM ballast_operations WHERE id=${id}`;
    return publicOperation(row);
  } catch (error) {
    const message =
      error instanceof HttpError
        ? error.message
        : signed || faucetStarted
          ? "Submission could not be confirmed. Please do not repeat this action until its network status is checked."
          : "The action could not be prepared. Please try again.";
    const uncertain = signed || faucetStarted;
    const next = new Date(Date.now() + retryDelay(attempt)).toISOString();
    await sql`UPDATE ballast_operations SET status=${uncertain ? "uncertain" : "error"},execution=${uncertain ? "pending" : "error"},error=${message},next_retry_at=${next},updated_at=now() WHERE id=${id} AND attempt=${attempt} AND status NOT IN ('FINALIZED','CANCELED')`;
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, message);
  } finally {
    await sql`UPDATE ballast_accounts SET submit_lock=NULL,submit_lock_at=NULL WHERE privy_id=${user.id} AND submit_lock=${lease}`;
  }
}

export async function getOperations(userId: string): Promise<Operation[]> {
  const sql = db();
  const rows =
    await sql`SELECT id,kind,status,tx_hash,evm_hash,(signed_payload IS NOT NULL) AS has_signed_payload,execution,error,created_at,updated_at,votes,attempt,next_retry_at FROM ballast_operations WHERE user_id=${userId} AND (status NOT IN ('FINALIZED','CANCELED','error','UNDETERMINED','LEADER_TIMEOUT','VALIDATORS_TIMEOUT') OR id IN (SELECT id FROM ballast_operations WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 25)) ORDER BY created_at DESC`;
  return rows.map((row) => publicOperation(row));
}
export async function syncOperation(userId: string, id: string) {
  const sql = db();
  const [row] =
    await sql`SELECT * FROM ballast_operations WHERE user_id=${userId} AND id=${id}`;
  if (!row) throw new HttpError(404, "Activity not found.");
  if (TERMINAL_STATUSES.includes(row.status) || row.status === "error")
    return publicOperation(row);
  if (Date.now() - new Date(row.updated_at).getTime() < 8000)
    return publicOperation(row);
  if (
    !row.tx_hash &&
    !row.evm_hash &&
    !row.signed_payload &&
    ["preparing", "submitting"].includes(row.status) &&
    Date.now() - new Date(row.updated_at).getTime() > 120000
  ) {
    const recovered =
      await sql`UPDATE ballast_operations SET status='error',execution='error',error='Preparation stopped before broadcast. This action can be retried.',updated_at=now() WHERE id=${id} AND attempt=${row.attempt} AND status IN ('preparing','submitting') AND signed_payload IS NULL AND tx_hash IS NULL RETURNING *`;
    return publicOperation(recovered[0] ?? row);
  }
  const client = chainClient();
  let raw;
  if (!row.tx_hash && row.evm_hash) {
    try {
      const found = await client.getTransaction({ hash: row.evm_hash });
      if (found && typeof found.statusName === "string") {
        raw = found;
        row.tx_hash = row.evm_hash;
      }
    } catch {
      /* Inspect the durable EVM identity next. */
    }
    if (!raw) {
      const receipt = await client.request({
        method: "eth_getTransactionReceipt",
        params: [row.evm_hash],
      });
      if (receipt?.status === "0x0") {
        await sql`UPDATE ballast_operations SET status='FINALIZED',execution='error',tx_hash=${row.evm_hash},error='The network rejected this transaction before contract execution.',updated_at=now() WHERE id=${id}`;
        return publicOperation({
          ...row,
          status: "FINALIZED",
          execution: "error",
          tx_hash: row.evm_hash,
        });
      }
      if (receipt?.logs) {
        const events = parseEventLogs({
          abi: [
            ...(client.chain.consensusMainContract?.abi ?? []),
            ...parseAbi([
              "event CreatedTransaction(bytes32 indexed txId, uint256 txSlot)",
            ]),
          ],
          logs: receipt.logs,
          strict: false,
        });
        const created = events.find(
          (event) =>
            "eventName" in event &&
            typeof event.eventName === "string" &&
            ["NewTransaction", "CreatedTransaction"].includes(event.eventName),
        );
        if (
          created &&
          "args" in created &&
          created.args &&
          typeof created.args === "object" &&
          "txId" in created.args
        )
          row.tx_hash = String(created.args.txId);
      }
      if (!row.tx_hash && row.signed_payload) {
        const payload = decryptPayload(
          row.signed_payload,
          env("CUSTODY_MASTER_KEY"),
          userId + ":" + id + ":" + row.attempt,
        );
        if (
          !/^0x[a-f0-9]+$/i.test(payload) ||
          keccak256(payload as `0x${string}`) !== row.evm_hash
        )
          throw new HttpError(
            409,
            "Saved transaction integrity could not be verified.",
          );
        // Identical signed bytes and nonce: retrying transport cannot duplicate the action.
        await client.sendRawTransaction({
          serializedTransaction: payload as `0x${string}`,
        });
        await sql`UPDATE ballast_operations SET updated_at=now() WHERE id=${id}`;
        return publicOperation(row);
      }
    }
  }
  if (!row.tx_hash) return publicOperation(row);
  raw ??= await client.getTransaction({ hash: row.tx_hash });
  const result = inspectReceipt(raw);
  const retryAt =
    result.status === "CANCELED" ||
    (result.status === "FINALIZED" && result.execution === "error")
      ? new Date(Date.now() + retryDelay(row.attempt)).toISOString()
      : null;
  await sql`UPDATE ballast_operations SET tx_hash=${row.tx_hash},status=${result.status},execution=${result.execution},error=${result.error ?? null},next_retry_at=${retryAt},votes=${JSON.stringify(result.votes)}::jsonb,updated_at=now() WHERE id=${id}`;
  if (result.status === "FINALIZED" && result.execution === "success")
    await invalidateOverview();
  return publicOperation({
    ...row,
    ...result,
    tx_hash: row.tx_hash,
    error: result.error ?? null,
    next_retry_at: retryAt,
  });
}
