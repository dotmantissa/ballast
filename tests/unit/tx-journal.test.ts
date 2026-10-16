import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const raw = "0x1234" as const;
const hash = ("0x" + "a".repeat(64)) as `0x${string}`;
const fake = vi.hoisted(() => ({ getTransaction: vi.fn(), request: vi.fn(), sendRawTransaction: vi.fn() }));
vi.mock("genlayer-js", () => ({
  createAccount: () => ({ address: "0x" + "1".repeat(40), signTransaction: async () => "0x1234" }),
  createClient: ({ account }: { account: unknown }) => ({ ...fake, account, chain: { consensusMainContract: { abi: [] } } }),
}));
import { transactionJournal } from "../../scripts/tx-journal";
const dirs: string[] = [];
afterEach(async () => { vi.clearAllMocks(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function fixture() { const dir = await mkdtemp(join(tmpdir(), "ballast-journal-")); dirs.push(dir); return join(dir, "journal"); }
it("persists signed bytes with owner-only permissions before broadcast and resumes without another send", async () => {
  const path = await fixture();
  const journal = await transactionJournal(path, raw);
  const send = vi.fn(async () => {
    await journal.account.signTransaction({} as never);
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.deploy.raw).toBe(raw);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    return hash;
  });
  expect(await journal.submit("deploy", { source: "one" }, send)).toBe(hash);
  const resumed = await transactionJournal(path, raw);
  expect(await resumed.submit("deploy", { source: "one" }, send)).toBe(hash);
  expect(send).toHaveBeenCalledTimes(1);
  await expect(resumed.submit("deploy", { source: "two" }, send)).rejects.toThrow("Operation changed");
});
it("recovers an interrupted broadcast from its saved identity without signing again", async () => {
  const path = await fixture();
  const journal = await transactionJournal(path, raw);
  await expect(journal.submit("claim", { args: [1] }, async () => {
    await journal.account.signTransaction({} as never);
    throw Error("Connection lost");
  })).rejects.toThrow("Connection lost");
  fake.getTransaction.mockResolvedValue({ statusName: "FINALIZED" });
  const resumed = await transactionJournal(path, raw);
  const send = vi.fn();
  expect(await resumed.submit("claim", { args: [1] }, send)).toMatch(/^0x/);
  expect(send).not.toHaveBeenCalled();
  expect(fake.sendRawTransaction).not.toHaveBeenCalled();
});
