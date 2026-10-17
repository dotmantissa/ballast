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

it.each([
  {result_name:'MAJORITY_DISAGREE'},
  {resultName:'MAJORITY_DISAGREE'},
  {result:7},
])('does not report a successful proposal as committed after rejection %j', outcome=>{
  const result=inspectReceipt({statusName:'FINALIZED',...outcome,txExecutionResultName:'FINISHED_WITH_RETURN',consensus_data:{leader_receipt:[{execution_result:'SUCCESS'},{execution_result:'ERROR'}]}});
  expect(result.execution).toBe('error');expect(result.error).toContain('did not agree');
});
it('uses the primary Studio receipt instead of unrelated idle attempts',()=>{
  expect(inspectReceipt({status:'FINALIZED',result_name:'MAJORITY_AGREE',consensus_data:{leader_receipt:[{execution_result:'ERROR'},{execution_result:'SUCCESS'}]}}).execution).toBe('error');
  expect(inspectReceipt({status:'FINALIZED',result_name:'MAJORITY_AGREE',consensus_data:{leader_receipt:[{execution_result:'SUCCESS'},{execution_result:'ERROR'}]}}).execution).toBe('success');
});
it('accepts an agreed SDK return and rejects a numeric execution error',()=>{
  expect(inspectReceipt({statusName:'FINALIZED',result:6,txExecutionResult:1}).execution).toBe('success');
  expect(inspectReceipt({statusName:'FINALIZED',result:6,txExecutionResult:2}).execution).toBe('error');
});

it.each(['PENDING','COMMITTING','REVEALING'])('keeps the %s proposal pending until a decision',status=>{
 expect(inspectReceipt({status,result:0,consensus_data:{leader_receipt:[{execution_result:'SUCCESS'}]}}).execution).toBe('pending');
});
