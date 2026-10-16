import "./rpc-transport";
import "./studio-lock";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  type CalldataEncodable,
} from "genlayer-js/types";
import { transactionJournal } from "./tx-journal";

const path = process.env.BALLAST_DEPLOYMENT_FILE ?? "deployments/studio.json";
const state = JSON.parse(await readFile(path, "utf8"));
const key = process.env.GENLAYER_DEPLOYER_KEY as `0x${string}`;
if (!/^0x[0-9a-f]{64}$/i.test(key ?? ""))
  throw Error("Deployment key is missing");
const {client, submit, wait} = await transactionJournal(path + "." + (state.deploymentGeneration ?? "initial") + ".journal", key);
async function save() {
  await writeFile(path + ".tmp", JSON.stringify(state, null, 2) + "\n");
  await rename(path + ".tmp", path);
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
      hash = await submit(name, {digest, parameters}, () => client.deployContract({
        code: new TextEncoder().encode(code),
        args: parameters,
        leaderOnly: false,
      }));
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
    hash = await submit(name, {target, fn, args}, () => client.writeContract({
      address: target,
      functionName: fn,
      args: [...args],
      value: 0n,
    }));
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
