import type { Claim, Finding } from "./types";
export function hasMutualAcceptance(claim: Pick<Claim, "claimant" | "operator" | "acceptances">) {
  const accepted = new Set((claim.acceptances ?? []).map(address => address.toLowerCase()));
  return accepted.has(claim.claimant.toLowerCase()) && accepted.has(claim.operator.toLowerCase());
}
export function challengeWindowOpen(claim: Pick<Claim, "status" | "challenge_until" | "claimant" | "operator" | "acceptances">, nowSeconds: number) {
  return claim.status === "challenge" && !hasMutualAcceptance(claim) && nowSeconds < claim.challenge_until;
}
export function canAppeal(claim: Claim, field: Finding, account?: string) {
  if (!account || hasMutualAcceptance(claim)) return false;
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
  if (value === 0n || free >= value) return shares;
  // Use the upper bound of the rounded share price so the estimate cannot overdraw free backing.
  const available = (free * shares) / (value + 1n);
  return available < shares ? available : shares;
}
