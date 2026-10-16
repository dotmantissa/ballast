import { describe, it, expect } from "vitest";
import { inspectReceipt, jsonSafe } from "../../lib/receipt";
describe("execution and consensus are distinct", () => {
  it("does not mistake accepted execution errors for success", () =>
    expect(
      inspectReceipt({
        status: "ACCEPTED",
        consensus_data: {
          leader_receipt: [{ execution_result: "ERROR", error: "Denied" }],
        },
      }),
    ).toMatchObject({
      status: "ACCEPTED",
      execution: "error",
      error: "Denied",
    }));
  it("does not infer success from finalized status alone", () =>
    expect(inspectReceipt({ status: "FINALIZED" }).execution).toBe("pending"));
  it("reads both Studio and SDK result representations", () => {
    expect(
      inspectReceipt({
        status: "FINALIZED",
        consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
      }).execution,
    ).toBe("success");
    expect(
      inspectReceipt({
        statusName: "FINALIZED",
        txExecutionResultName: "FINISHED_WITH_RETURN",
      }).execution,
    ).toBe("success");
  });
  it("exposes actual votes without inventing progress", () =>
    expect(
      inspectReceipt({
        status: "REVEALING",
        consensus_data: { votes: { "0x1": "agree", "0x2": "disagree" } },
      }).votes,
    ).toEqual([
      { validator: "0x1", vote: "agree" },
      { validator: "0x2", vote: "disagree" },
    ]));
  it("serializes financial integers without rounding", () =>
    expect(jsonSafe({ amount: 100000000000000000001n })).toEqual({
      amount: "100000000000000000001",
    }));
});
