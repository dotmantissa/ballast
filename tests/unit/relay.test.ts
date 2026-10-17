import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
const model = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  lease: null as string | null,
  history: [] as Record<string, unknown>[],
  write: vi.fn(),
  getTransaction: vi.fn(),
  sendRaw: vi.fn(),
  balance: vi.fn(),
  onSigned: undefined as undefined | ((raw: `0x${string}`) => Promise<void>),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/server/env", () => ({ env: () => "a".repeat(64) }));
vi.mock("../../lib/server/auth", () => ({
  HttpError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("../../lib/server/accounts", () => ({
  getAccount: async () => ({
    address: "0x" + "1".repeat(40),
    key: () => "0x" + "2".repeat(64),
  }),
  rateLimit: async () => true,
}));
vi.mock("../../lib/server/chain", () => ({
  addresses: {
    underwriting: "0x" + "3".repeat(40),
    court: "0x" + "4".repeat(40),
    registry: "0x" + "5".repeat(40),
  },
  invalidateOverview: async () => {},
  read: vi.fn(),
  chainClient: (_key: unknown, onSigned: typeof model.onSigned) => {
    if (onSigned) model.onSigned = onSigned;
    return {
      chain: { consensusMainContract: { abi: [] } },
      getBalance: model.balance,
      writeContract: model.write,
      getTransaction: model.getTransaction,
      sendRawTransaction: model.sendRaw,
      request: async () => null,
    };
  },
}));
vi.mock("../../lib/server/db", () => {
  const sql = Object.assign(
    async (strings: TemplateStringsArray, ...v: unknown[]) => {
      const q = strings.join("?").replace(/\s+/g, " ").trim();
      if (q.startsWith("SELECT * FROM ballast_operations"))
        return [...model.rows.values()]
          .filter((r) =>
            q.includes("idempotency_key")
              ? r.user_id === v[0] && r.idempotency_key === v[1]
              : q.includes("user_id")
                ? r.user_id === v[0] && r.id === v[1]
                : r.id === v[0],
          )
          .map((r) => ({ ...r }));
      if (q.startsWith("SELECT id FROM ballast_operations"))
        return [...model.rows.values()].filter(
          (r) =>
            r.user_id === v[0] &&
            r.id !== v[1] &&
            ["signed", "uncertain"].includes(String(r.status)),
        );
      if (q.startsWith("UPDATE ballast_accounts SET submit_lock=NULL")) {
        if (model.lease === v[1]) model.lease = null;
        return [];
      }
      if (q.startsWith("UPDATE ballast_accounts SET submit_lock=")) {
        if (model.lease) return [];
        model.lease = String(v[0]);
        return [{ address: "0x" + "1".repeat(40) }];
      }
      if (q.startsWith("INSERT INTO ballast_operations(")) {
        model.rows.set(String(v[0]), {
          id: v[0],
          user_id: v[1],
          idempotency_key: v[2],
          kind: v[3],
          action_hash: v[4],
          attempt: 1,
          status: "preparing",
          execution: "pending",
          tx_hash: null,
          evm_hash: null,
          signed_payload: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          votes: [],
        });
        return [];
      }
      if (q.startsWith("INSERT INTO ballast_operation_attempts")) {
        model.history.push({ ...model.rows.get(String(v[0])) });
        return [];
      }
      if (q.startsWith("UPDATE ballast_operations SET attempt=")) {
        Object.assign(model.rows.get(String(v[1]))!, {
          attempt: v[0],
          status: "preparing",
          execution: "pending",
          tx_hash: null,
          evm_hash: null,
          signed_payload: null,
          nonce: null,
          error: null,
          next_retry_at: null,
          updated_at: new Date().toISOString(),
        });
        return [];
      }
      if (q.startsWith("UPDATE ballast_operations SET signed_payload=")) {
        const row = model.rows.get(String(v[3]));
        if (
          !row ||
          row.attempt !== v[4] ||
          model.lease !== v[7] ||
          (row.evm_hash && row.evm_hash !== v[5])
        )
          return [];
        Object.assign(row, {
          signed_payload: v[0],
          evm_hash: v[1],
          nonce: v[2],
          status: "signed",
          updated_at: new Date().toISOString(),
        });
        return [{ id: row.id }];
      }
      if (q.startsWith("UPDATE ballast_operations SET status='submitting'")) {
        Object.assign(model.rows.get(String(v[0]))!, {
          status: "submitting",
          updated_at: new Date().toISOString(),
        });
        return [];
      }
      if (
        q.startsWith("UPDATE ballast_operations SET tx_hash=") &&
        q.includes("status='PENDING'")
      ) {
        Object.assign(model.rows.get(String(v[1]))!, {
          tx_hash: v[0],
          status: "PENDING",
          updated_at: new Date().toISOString(),
        });
        return [];
      }
      if (q.startsWith("UPDATE ballast_operations SET status=?")) {
        const row = model.rows.get(String(v[4]));
        if (row && row.attempt === v[5])
          Object.assign(row, {
            status: v[0],
            execution: v[1],
            error: v[2],
            next_retry_at: v[3],
            updated_at: new Date().toISOString(),
          });
        return [];
      }
      if (q.startsWith("UPDATE ballast_operations SET tx_hash=")) {
        Object.assign(model.rows.get(String(v[6]))!, {
          tx_hash: v[0],
          status: v[1],
          execution: v[2],
          error: v[3],
          next_retry_at: v[4],
          votes: JSON.parse(String(v[5])),
          updated_at: new Date().toISOString(),
        });
        return [];
      }
      if (q.startsWith("UPDATE ballast_operations SET updated_at=")) {
        Object.assign(model.rows.get(String(v[0]))!, {
          updated_at: new Date().toISOString(),
        });
        return [];
      }
      throw Error("Unhandled test SQL: " + q);
    },
    {
      transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
    },
  );
  return { db: () => sql };
});
import { submitAction, syncOperation } from "../../lib/server/operations";
const user = { id: "relay-test-user", email: "relay@example.org" };
const action = {
  kind: "resolve",
  claimId: "a".repeat(24),
  finding: "harm",
} as const;
const key = "11111111-1111-4111-8111-111111111111";
const account = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
function advance(seconds: number) {
  vi.setSystemTime(Date.now() + seconds * 1000);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  model.rows.clear();
  model.history = [];
  model.lease = null;
  model.onSigned = undefined;
  model.write.mockReset();
  model.getTransaction.mockReset();
  model.sendRaw.mockReset();
  model.balance.mockReset().mockResolvedValue(100n * 10n ** 18n);
  model.getTransaction.mockRejectedValue(Error("not found"));
  model.sendRaw.mockResolvedValue("0x" + "8".repeat(64));
  model.write.mockImplementation(async () => {
    const raw = await account.signTransaction({
      chainId: 61999,
      type: "legacy",
      to: ("0x" + "3".repeat(40)) as `0x${string}`,
      nonce: 7 + model.write.mock.calls.length,
      gas: 200000n,
      gasPrice: 0n,
      value: 0n,
    });
    await model.onSigned!(raw);
    return "0x" + "8".repeat(64);
  });
});
afterEach(() => vi.useRealTimers());
describe("durable relay attempts", () => {
  it("retries a failed preparation under the same key, preserving its history", async () => {
    model.balance.mockRejectedValueOnce(Error("transient read failure"));
    await expect(submitAction(user, action, key)).rejects.toThrow(
      "could not be prepared",
    );
    const first = [...model.rows.values()][0];
    expect(first.status).toBe("error");
    expect(model.write).not.toHaveBeenCalled();
    advance(6);
    const next = await submitAction(user, action, key);
    expect(next.id).toBe(first.id);
    expect(next.attempt).toBe(2);
    expect(next.status).toBe("PENDING");
    expect(model.history).toHaveLength(1);
    expect(model.rows.get(next.id)?.signed_payload).toBeTruthy();
    expect(JSON.stringify(next)).not.toContain("signed_payload");
  });
  it("persists the signed identity before any broadcast and reuses exact bytes on uncertainty", async () => {
    let signedRaw = "";
    model.write.mockImplementationOnce(async () => {
      const raw = await account.signTransaction({
        chainId: 61999,
        type: "legacy",
        to: ("0x" + "3".repeat(40)) as `0x${string}`,
        nonce: 7,
        gas: 200000n,
        gasPrice: 0n,
        value: 0n,
      });
      signedRaw = raw;
      await model.onSigned!(raw);
      const row = [...model.rows.values()][0];
      expect(row.evm_hash).toBeTruthy();
      expect(row.signed_payload).not.toContain(raw);
      throw Error("connection lost after broadcast");
    });
    await expect(submitAction(user, action, key)).rejects.toThrow(
      "could not be confirmed",
    );
    advance(10);
    const next = await submitAction(user, action, key);
    expect(next.status).toBe("uncertain");
    expect(next.attempt).toBe(1);
    expect(model.write).toHaveBeenCalledTimes(1);
    expect(model.sendRaw).toHaveBeenCalledWith({
      serializedTransaction: signedRaw,
    });
    expect(model.history).toHaveLength(0);
  });
  it.each(["CANCELED", "FINALIZED"])(
    "retries a confirmed %s failure after reconciliation and backoff",
    async (status) => {
      const first = await submitAction(user, action, key);
      advance(10);
      model.getTransaction.mockResolvedValue({
        statusName: status,
        txExecutionResultName: "ERROR",
      });
      const failed = await syncOperation(user.id, first.id);
      expect(failed.retryable).toBe(true);
      const waiting = await submitAction(user, action, key);
      expect(waiting.attempt).toBe(1);
      advance(6);
      const retried = await submitAction(user, action, key);
      expect(retried.attempt).toBe(2);
      expect(model.write).toHaveBeenCalledTimes(2);
    },
  );
  it("never resubmits a successful operation or accepts a different action under its key", async () => {
    const first = await submitAction(user, action, key);
    advance(10);
    model.getTransaction.mockResolvedValue({
      statusName: "FINALIZED",
      txExecutionResultName: "SUCCESS",
    });
    await syncOperation(user.id, first.id);
    expect((await submitAction(user, action, key)).status).toBe("FINALIZED");
    expect(model.write).toHaveBeenCalledTimes(1);
    await expect(
      submitAction(user, { ...action, finding: "scope" }, key),
    ).rejects.toThrow("different action");
  });
  it("fences a stale signing callback before it can broadcast", async () => {
    model.write.mockImplementationOnce(async () => {
      model.lease = "new-owner";
      const raw = await account.signTransaction({
        chainId: 61999,
        type: "legacy",
        nonce: 8,
        gas: 200000n,
        gasPrice: 0n,
        value: 0n,
      });
      await model.onSigned!(raw);
      return "0x" + "8".repeat(64);
    });
    await expect(submitAction(user, action, key)).rejects.toThrow(
      "lease changed",
    );
    const row = [...model.rows.values()][0];
    expect(row.signed_payload).toBeNull();
    expect(row.status).toBe("error");
    expect(model.sendRaw).not.toHaveBeenCalled();
    expect(model.lease).toBe("new-owner");
  });
});

it.each(["redeem_legacy","withdraw_legacy"] as const)("routes %s only to the archived pool with zero value",async(kind)=>{
  const previous=(await import("../../deployments/previous-studio.json")).default;
  await submitAction(user,kind==="redeem_legacy"?{kind,tranche:"junior",shares:"1"}:{kind},key);
  expect(model.write).toHaveBeenCalledWith(expect.objectContaining({address:previous.underwriting,functionName:kind==="redeem_legacy"?"redeem":"withdraw",value:0n}));
});

it.each([
  ["agent", "registry", "publish_agent"],
  ["policy", "underwriting", "publish_policy"],
  ["claim", "court", "publish_final_claim"],
  ["settlement", "underwriting", "publish_settlement"],
] as const)("republishes %s confirmations through a fixed zero value route", async (target, contract, method) => {
  const { addresses } = await import("../../lib/server/chain");
  await submitAction(user, {kind:"publish_confirmation",target,recordId:"a".repeat(24)},key);
  expect(model.write).toHaveBeenCalledWith(expect.objectContaining({address:addresses[contract],functionName:method,args:["a".repeat(24)],value:0n}));
});

it.each([false,true])("requires a final filing seal before choosing expiry, sealed=%s",async(sealed)=>{
  const { read, addresses }=await import("../../lib/server/chain");
  vi.mocked(read).mockResolvedValueOnce(sealed?{policy_id:"a".repeat(24),total_requested:"1"}:{});
  await submitAction(user,{kind:"expire",policyId:"a".repeat(24)},key);
  expect(model.write).toHaveBeenCalledWith(expect.objectContaining({address:sealed?addresses.underwriting:addresses.court,functionName:sealed?"expire_policy":"seal_policy",value:0n}));
});
