import "./rpc-transport";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import {
  TransactionStatus,
  type CalldataEncodable,
  type TransactionHash,
} from "genlayer-js/types";
import { inspectReceipt } from "../lib/receipt";

const path = process.env.BALLAST_DEPLOYMENT_FILE ?? "deployments/studio.json";
const state = JSON.parse(await readFile(path, "utf8"));
const key = process.env.GENLAYER_DEPLOYER_KEY as `0x${string}`;
if (!/^0x[0-9a-f]{64}$/i.test(key ?? ""))
  throw Error("Deployment key is missing");
const client = createClient({ chain: studionet, account: createAccount(key) });
async function save() {
  await writeFile(path + ".tmp", JSON.stringify(state, null, 2) + "\n");
  await rename(path + ".tmp", path);
}
async function wait(hash: `0x${string}`) {
  let receipt;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const candidate = await client.getTransaction({
        hash: hash as TransactionHash,
      });
      if (inspectReceipt(candidate).status === TransactionStatus.FINALIZED) {
        receipt = candidate;
        break;
      }
    } catch {
      /* A read timeout must never cause a duplicate deployment. */
    }
    await new Promise((resolve) => setTimeout(resolve, 12000));
  }
  if (!receipt)
    throw Error("Receipt wait timed out. Resume with the saved hash: " + hash);

  const result = inspectReceipt(receipt);
  if (result.execution !== "success") {
    console.log(JSON.stringify(result));
    throw Error("Execution did not succeed: " + hash);
  }
  return receipt;
}
for (const [name, file, args] of [
  ["registry", "agent_registry", []],
  ["underwriting", "underwriting", null],
  ["court", "claims_court", null],
] as const) {
  const code = await readFile("contracts/" + file + ".py", "utf8");
  const digest = createHash("sha256").update(code).digest("hex");
  if (state[name] && state.sourceHashes?.[name] !== digest)
    throw Error(
      "Deployed source differs for " + name + ". Use a new deployment record.",
    );
  if (!state[name]) {
    let hash = state.transactions[name];
    if (!hash) {
      const parameters: CalldataEncodable[] = args
        ? [...args]
        : name === "underwriting"
          ? [state.registry]
          : [state.registry, state.underwriting];
      hash = await client.deployContract({
        code: new TextEncoder().encode(code),
        args: parameters,
        leaderOnly: false,
      });
      state.transactions[name] = hash;
      state.sourceHashes = { ...state.sourceHashes, [name]: digest };
      await save();
      console.log(name + " submitted " + hash);
    }
    const receipt = await wait(hash);
    const address =
      receipt.txDataDecoded && "contractAddress" in receipt.txDataDecoded
        ? receipt.txDataDecoded.contractAddress
        : (receipt.to_address ?? receipt.recipient);
    if (!address) throw Error("Missing deployment address");
    state[name] = address;
    await save();
    const schema = await client.getContractSchema(address);
    console.log(
      name +
        " deployed " +
        address +
        " schema " +
        JSON.stringify(schema).length +
        " bytes",
    );
  }
}
for (const [name, target, fn, args] of [
  ["wire_registry", state.registry, "wire_underwriting", [state.underwriting]],
  ["wire_pool", state.underwriting, "wire_court", [state.court]],
] as const) {
  if (state.wired?.[name]) continue;
  let hash = state.transactions[name];
  if (!hash) {
    hash = await client.writeContract({
      address: target,
      functionName: fn,
      args: [...args],
      value: 0n,
    });
    state.transactions[name] = hash;
    await save();
    console.log(name + " " + hash);
  }
  await wait(hash);
  state.wired = { ...state.wired, [name]: true };
  await save();
}
state.verifiedAt = new Date().toISOString();
await save();
console.log("Deployment and wiring verified.");
