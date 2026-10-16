import "./rpc-transport";
import { readFile, writeFile, rename } from "node:fs/promises";
import assert from "node:assert/strict";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import {
  TransactionHashVariant,
  type CalldataEncodable,
  type TransactionHash,
} from "genlayer-js/types";
import { inspectReceipt, jsonSafe } from "../lib/receipt";

const statePath = "deployments/integration.json";
const state = JSON.parse(await readFile(statePath, "utf8"));
if (!state.wired?.wire_pool)
  throw Error("Deploy an isolated integration instance first.");
const key = process.env.GENLAYER_DEPLOYER_KEY as `0x${string}`;
const client = createClient({ chain: studionet, account: createAccount(key) });
const owner = createAccount(key).address;
state.checks ??= {};
async function save() {
  await writeFile(statePath + ".tmp", JSON.stringify(state, null, 2) + "\n");
  await rename(statePath + ".tmp", statePath);
}
async function retryRead<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      if (attempt === 29)
        throw Error(
          "Studio remained unavailable. Saved transaction hashes are safe to resume.",
        );
      console.log("Studio read is waiting for network capacity.");
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
  throw Error("Unreachable");
}
async function wait(hash: TransactionHash) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const receipt = await client.getTransaction({ hash });
      const inspected = inspectReceipt(receipt);
      if (inspected.status === "FINALIZED") {
        assert.equal(inspected.execution, "success", inspected.error);
        return receipt;
      }
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }
  throw Error("Timed out waiting for " + hash);
}
async function read(
  contract: "registry" | "underwriting" | "court",
  method: string,
  args: CalldataEncodable[] = [],
) {
  return (await retryRead(() =>
    client.readContract({
      address: state[contract],
      functionName: method,
      args,
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    }),
  )) as Record<string, unknown>;
}
async function write(
  name: string,
  contract: "registry" | "underwriting" | "court",
  method: string,
  args: CalldataEncodable[],
  value = 0n,
) {
  if (state.checks[name]?.done) return;
  let hash = state.checks[name]?.hash;
  if (!hash) {
    hash = await client.writeContract({
      address: state[contract],
      functionName: method,
      args,
      value,
      leaderOnly: false,
    });
    state.checks[name] = { hash };
    await save();
    console.log(name + " submitted " + hash);
  }
  await wait(hash);
  state.checks[name].done = true;
  await save();
  console.log(name + " execution succeeded");
}
const registry = await read("registry", "get_config");
const pool = await read("underwriting", "get_dashboard");
const court = await read("court", "get_config");
assert.equal(registry.underwriting, state.underwriting);
assert.equal(pool.court, state.court);
assert.equal(court.registry, state.registry);
assert.equal(court.underwriting, state.underwriting);
console.log("All cross contract links verified.");
if (!state.funded) {
  await client.request({
    method: "sim_fundAccount",
    params: [owner, 25 * 10 ** 18],
  });
  state.funded = true;
  await save();
}
await write(
  "stake_junior",
  "underwriting",
  "stake",
  ["junior"],
  2n * 10n ** 18n,
);
let holdings = await read("underwriting", "get_account", [owner]);
if (!state.checks.redeem_junior?.done)
  assert.equal(String(holdings.junior_value), "2000000000000000000");
await write("redeem_junior", "underwriting", "redeem", [
  "junior",
  BigInt(String(holdings.junior_shares)),
]);
holdings = await read("underwriting", "get_account", [owner]);
if (!state.checks.withdraw_capital?.done)
  assert.equal(String(holdings.credit), "2000000000000000000");
await write("withdraw_capital", "underwriting", "withdraw", []);
holdings = await read("underwriting", "get_account", [owner]);
assert.equal(String(holdings.credit), "0");
let returned = false;
for (let i = 0; i < 10; i++) {
  if (
    (await retryRead(() => client.getBalance({ address: owner }))) >=
    25n * 10n ** 18n
  ) {
    returned = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 6000));
}
assert.ok(returned, "Native withdrawal did not return funds to the account");
console.log("Native withdrawal reached the recipient account.");
const manifest = JSON.stringify({
  name: "Integration boundary fixture",
  scope:
    "This isolated test identity has no authority to spend. It exists only to verify registry and evidence rejection. No actual agent operating history is asserted.",
  executor_address: owner,
  spend_limit_gen: 0,
});
await write("register_fixture", "registry", "register_agent", [
  manifest,
  ["https://docs.genlayer.com/developers/networks"],
]);
const agents = (await retryRead(() =>
  client.readContract({
    address: state.registry,
    functionName: "list_agents",
    args: [0, 50],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  }),
)) as Record<string, unknown>[];
const agent = agents.find((a) => a.name === "Integration boundary fixture");
assert.ok(agent);
await write("assess_unsupported_cover", "underwriting", "quote_policy", [
  agent.id as string,
  10n ** 18n,
  [
    "https://docs.genlayer.com/developers/intelligent-contracts/features/value-transfers",
  ],
]);
const quotes = (await retryRead(() =>
  client.readContract({
    address: state.underwriting,
    functionName: "list_quotes",
    args: [0, 50],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  }),
)) as Record<string, unknown>[];
assert.equal(
  quotes.at(-1)?.band,
  "declined",
  "Unsupported activity must not receive cover",
);
state.verifiedAt = new Date().toISOString();
state.result = "passed";
await save();
await writeFile(
  "docs/integration-result.json",
  JSON.stringify(
    jsonSafe({
      network: "studionet",
      verifiedAt: state.verifiedAt,
      registry: state.registry,
      underwriting: state.underwriting,
      court: state.court,
      checks: state.checks,
      result: "passed",
      scope:
        "Deployment, wiring, real native capital movement, immutable registration and independent validator rejection of unsupported cover. Full claim lifecycle is tested in direct mode with the 24 hour challenge period.",
    }),
    null,
    2,
  ) + "\n",
);
console.log(
  "Live integration passed. Application contracts were not populated.",
);
