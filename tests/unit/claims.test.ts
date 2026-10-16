import { expect, it } from "vitest";
import { canAppeal, redeemableShares } from "../../lib/claims";
import type { Claim } from "../../lib/types";
const claim = {
  claimant: "0x" + "1".repeat(40),
  operator: "0x" + "2".repeat(40),
  eligibility_revision: 0,
  appeals: [],
} as unknown as Claim;
it("keeps the claimant appeal available after the operator appeals", () => {
  const c = {
    ...claim,
    appeals: [{ field: "harm", by: claim.operator, revision: 0 }],
  } as Claim;
  expect(canAppeal(c, "harm", claim.claimant)).toBe(true);
  expect(canAppeal(c, "harm", claim.operator)).toBe(false);
  expect(canAppeal(c, "harm", "0x" + "3".repeat(40))).toBe(false);
});
it("restores payout appeal rights for a new eligibility revision", () => {
  const c = {
    ...claim,
    appeals: [{ field: "payout", by: claim.claimant, revision: 0 }],
  } as Claim;
  expect(canAppeal(c, "payout", claim.claimant)).toBe(false);
  expect(
    canAppeal({ ...c, eligibility_revision: 1 }, "payout", claim.claimant),
  ).toBe(true);
});
it("estimates redemption using free tranche backing, retaining premium locks", () => {
  expect(redeemableShares("100", "140", "0")).toBe(0n);
  expect(redeemableShares("100", "140", "70")).toBeLessThan(51n);
  expect(redeemableShares("100", "140", "1000")).toBe(100n);
});
