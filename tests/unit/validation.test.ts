import { describe, it, expect } from "vitest";
import { actionSchema, publicUrl } from "../../lib/validation";
const id = "a".repeat(24);
describe("action boundary", () => {
  it.each([
    "http://example.com",
    "https://localhost/x",
    "https://127.0.0.1",
    "https://[::1]",
    "https://user:pass@example.com",
    "https://service.local/x",
    "https://example.com:8443",
  ])("rejects non public evidence %s", (url) =>
    expect(publicUrl.safeParse(url).success).toBe(false),
  );
  it("requires diversity and a public disclosure acknowledgement", () => {
    const claim = {
      kind: "claim",
      policyId: id,
      incidentRef: "0x" + "a".repeat(64),
      incidentAt: 1,
      amount: "1",
      statement: "A detailed account of this specific incident and the loss.",
      evidenceUrls: ["https://example.com/a", "https://example.com/b"],
      publicConsent: true,
    };
    expect(actionSchema.safeParse(claim).success).toBe(false);
    expect(
      actionSchema.safeParse({
        ...claim,
        evidenceUrls: ["https://one.example/a", "https://two.example/b"],
      }).success,
    ).toBe(true);
    expect(
      actionSchema.safeParse({ ...claim, publicConsent: false }).success,
    ).toBe(false);
  });
  it.each([
    "0",
    "-1",
    "100.000000000000000001",
    "1e2",
    "1.0000000000000000001",
  ])("rejects invalid cover amount %s", (limit) =>
    expect(
      actionSchema.safeParse({
        kind: "quote",
        agentId: id,
        limit,
        peerUrls: ["https://public.example/report"],
      }).success,
    ).toBe(false),
  );
  it("preserves exact integer amounts at the cap", () =>
    expect(
      actionSchema.parse({ kind: "stake", tranche: "junior", amount: "100" })
        .kind,
    ).toBe("stake"));
  it("does not expose arbitrary method calls or addresses", () => {
    expect(
      actionSchema.safeParse({
        kind: "write",
        method: "wire_court",
        address: "0x123",
      }).success,
    ).toBe(false);
  });
});

it("limits confirmation recovery to known records and methods",()=>{
  expect(actionSchema.safeParse({kind:"publish_confirmation",target:"claim",recordId:id}).success).toBe(true);
  expect(actionSchema.safeParse({kind:"publish_confirmation",target:"withdraw",recordId:id}).success).toBe(false);
  expect(actionSchema.safeParse({kind:"publish_confirmation",target:"policy",recordId:"../secret"}).success).toBe(false);
});
