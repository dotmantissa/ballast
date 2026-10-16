import type { Claim, Finding } from "./types";
export function canAppeal(claim: Claim, field: Finding, account?: string) {
  if (!account) return false;
  const address = account.toLowerCase();
  if (
    ![claim.claimant.toLowerCase(), claim.operator.toLowerCase()].includes(
      address,
    )
  )
    return false;
  const revision = field === "payout" ? claim.eligibility_revision : 0;
  return !claim.appeals.some(
    (a) =>
      a.field === field &&
      a.by.toLowerCase() === address &&
      a.revision === revision,
  );
}
export function redeemableShares(
  owned: string,
  positionValue: string,
  freeCapital: string,
) {
  const shares = BigInt(owned);
  const value = BigInt(positionValue);
  const free = BigInt(freeCapital);
  if (value === 0n) return shares;
  // Use the upper bound of the rounded share price so the estimate cannot overdraw free backing.
  const available = (free * shares) / (value + 1n);
  return available < shares ? available : shares;
}
