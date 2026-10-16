import { describe, expect, it } from "vitest";
import {
  recoveryState,
  retryDelay,
  operationView,
  type SavedOperation,
} from "../../lib/operation-recovery";
const operation: SavedOperation = {
  id: "test",
  kind: "resolve",
  status: "error",
  execution: "error",
  tx_hash: null,
  attempt: 1,
};
describe("operation recovery", () => {
  it("retries a preparation error with the original logical request key", () =>
    expect(recoveryState(operation)).toBe("retry"));
  it("retries only a proven failure when a transaction was broadcast", () => {
    expect(
      recoveryState({
        ...operation,
        status: "FINALIZED",
        execution: "error",
        tx_hash: "0x1",
      }),
    ).toBe("retry");
    expect(
      recoveryState({ ...operation, status: "CANCELED", tx_hash: "0x1" }),
    ).toBe("retry");
    expect(
      recoveryState({
        ...operation,
        status: "FINALIZED",
        execution: "success",
        tx_hash: "0x1",
      }),
    ).toBe("complete");
  });
  it.each([
    "UNDETERMINED",
    "LEADER_TIMEOUT",
    "VALIDATORS_TIMEOUT",
    "ACCEPTED",
    "PENDING",
  ])("never replays an appealable or active %s decision", (status) =>
    expect(recoveryState({ ...operation, status, tx_hash: "0x1" })).toBe(
      "wait",
    ),
  );
  it("reconciles an unknown broadcast rather than preparing a fresh nonce", () => {
    expect(
      recoveryState({
        ...operation,
        status: "uncertain",
        evm_hash: "0x1",
        signed_payload: "encrypted",
      }),
    ).toBe("reconcile");
    expect(
      recoveryState({
        ...operation,
        status: "signed",
        signed_payload: "encrypted",
      }),
    ).toBe("reconcile");
    expect(
      recoveryState({
        ...operation,
        status: "error",
        signed_payload: "encrypted",
      }),
    ).not.toBe("retry");
  });
  it("can recover a crashed preparation only when no signed payload ever escaped", () => {
    const updated_at = new Date(0).toISOString();
    expect(
      recoveryState({ ...operation, status: "submitting", updated_at }, 200000),
    ).toBe("retry");
    expect(
      recoveryState(
        { ...operation, status: "submitting", updated_at, evm_hash: "0x1" },
        200000,
      ),
    ).toBe("reconcile");
    expect(
      recoveryState({ ...operation, status: "preparing", updated_at }, 1000),
    ).toBe("wait");
  });
  it("backs off repeated failures without an unbounded delay", () => {
    expect(retryDelay(1)).toBe(5000);
    expect(retryDelay(2)).toBe(10000);
    expect(retryDelay(100)).toBe(300000);
  });
  it("never exposes encrypted broadcasts or arbitrary database fields", () => {
    const row = {
      ...operation,
      signed_payload: "private broadcast",
      evm_hash: "0x1",
      encrypted_key: "private key",
      action_hash: "internal",
    };
    const response = operationView(row);
    expect(JSON.stringify(response)).not.toMatch(
      /private broadcast|private key|signed_payload|encrypted_key|action_hash|evm_hash/,
    );
  });
});
