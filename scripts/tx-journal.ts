import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { keccak256, parseAbi, parseEventLogs } from "viem";
import type { TransactionHash } from "genlayer-js/types";
import { inspectReceipt, jsonSafe } from "../lib/receipt";

type Entry = { fingerprint: string; raw?: `0x${string}`; evmHash?: `0x${string}`; hash?: TransactionHash };
/** Local tooling journal. Exact signed bytes stay in an ignored, owner-only file. */
export async function transactionJournal(path: string, key: `0x${string}`) {
  let entries: Record<string, Entry> = {};
  try { entries = JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let active: Entry | undefined;
  async function save() {
    await writeFile(path + ".tmp", JSON.stringify(entries, null, 2) + "\n", { mode: 0o600 });
    await chmod(path + ".tmp", 0o600);
    await rename(path + ".tmp", path);
  }
  const account = createAccount(key);
  const sign = account.signTransaction;
  account.signTransaction = async (...args) => {
    if (!active) throw Error("No durable operation selected");
    const raw = await sign(...args);
    if (active.raw && active.raw !== raw) throw Error("Uncertain broadcast must be reconciled before signing another transaction");
    active.raw = raw;
    active.evmHash = keccak256(raw);
    await save();
    return raw;
  };
  const client = createClient({ chain: studionet, account });
  async function recover(entry: Entry) {
    if (!entry.evmHash || !entry.raw) throw Error("Incomplete saved broadcast");
    // Studio may resolve the deterministic EVM identity directly.
    try {
      const tx = await client.getTransaction({ hash: entry.evmHash as TransactionHash });
      if (tx && typeof tx.statusName === "string") return entry.evmHash as TransactionHash;
    } catch { /* Resolve consensus identity from EVM logs. */ }
    let receipt = await client.request({ method: "eth_getTransactionReceipt", params: [entry.evmHash] });
    if (!receipt) {
      await client.sendRawTransaction({ serializedTransaction: entry.raw });
      receipt = await client.request({ method: "eth_getTransactionReceipt", params: [entry.evmHash] });
    }
    if (receipt?.status === "0x0") throw Error("Saved broadcast reverted: " + entry.evmHash);
    const events = parseEventLogs({
      abi: [...(client.chain.consensusMainContract?.abi ?? []), ...parseAbi(["event CreatedTransaction(bytes32 indexed txId, uint256 txSlot)"])],
      logs: receipt?.logs ?? [], strict: false,
    });
    const event = events.find(e => "eventName" in e && ["NewTransaction", "CreatedTransaction"].includes(String(e.eventName)));
    if (event && "args" in event && event.args && typeof event.args === "object" && "txId" in event.args) return String(event.args.txId) as TransactionHash;
    throw Error("Saved broadcast is still uncertain. Resume this journal; do not resubmit with another nonce.");
  }
  async function submit(name: string, payload: unknown, send: () => Promise<`0x${string}`>) {
    const fingerprint = createHash("sha256").update(JSON.stringify(jsonSafe({ sender: account.address, payload }))).digest("hex");
    const entry = entries[name] ??= { fingerprint };
    if (entry.fingerprint !== fingerprint) throw Error("Operation changed; use a fresh isolated journal: " + name);
    if (entry.hash) return entry.hash;
    if (entry.raw) entry.hash = await recover(entry);
    else {
      active = entry;
      await save();
      try { entry.hash = await send() as TransactionHash; }
      finally { active = undefined; }
    }
    await save();
    return entry.hash;
  }
  async function wait(hash: TransactionHash) {
    for (let i = 0; i < 150; i++) {
      try {
        const receipt = await client.getTransaction({ hash });
        const result = inspectReceipt(receipt);
        if (result.status === "FINALIZED") {
          if (result.execution !== "success") throw Object.assign(Error("Execution failed: " + hash), { finalFailure: true });
          return receipt;
        }
        if (result.status === "CANCELED") throw Object.assign(Error("Transaction canceled: " + hash), { finalFailure: true });
      } catch (error) { if ((error as { finalFailure?: boolean }).finalFailure) throw error; }
      await new Promise(resolve => setTimeout(resolve, 12000));
    }
    throw Error("Finality wait timed out; resume saved hash " + hash);
  }
  return { client, account, submit, wait };
}
