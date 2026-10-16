/** One stable request key per claim finding revision, including after a reload. */
export async function findingRequestKey(
  claimId: string,
  finding: string,
  revision: number | string,
  deployment = "ballast",
) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `ballast:${deployment}:${claimId}:${finding}:${revision}`,
      ),
    ),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
