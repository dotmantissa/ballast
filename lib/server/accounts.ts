import "server-only";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptKey, decryptKey } from "../custody";
import { env } from "./env";
import { db } from "./db";
export async function getAccount(user: { id: string; email: string }) {
  const sql = db();
  let [row] =
    await sql`SELECT address, encrypted_key FROM ballast_accounts WHERE privy_id=${user.id}`;
  if (!row) {
    const key = generatePrivateKey();
    const address = privateKeyToAccount(key).address;
    const encrypted = encryptKey(key, env("CUSTODY_MASTER_KEY"), user.id);
    await sql`INSERT INTO ballast_accounts (privy_id,email,address,encrypted_key) VALUES (${user.id},${user.email},${address},${encrypted}) ON CONFLICT (privy_id) DO NOTHING`;
    [row] =
      await sql`SELECT address,encrypted_key FROM ballast_accounts WHERE privy_id=${user.id}`;
  }
  return {
    address: row.address as `0x${string}`,
    key: () =>
      decryptKey(row.encrypted_key, env("CUSTODY_MASTER_KEY"), user.id),
  };
}
export async function rateLimit(userId: string) {
  const sql = db();
  const rows =
    await sql`INSERT INTO ballast_rate_limits (user_id,window_start,hits) VALUES (${userId},date_trunc('minute',now()),1) ON CONFLICT (user_id,window_start) DO UPDATE SET hits=ballast_rate_limits.hits+1 RETURNING hits`;
  return Number(rows[0].hits) <= 8;
}
