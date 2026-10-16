import { neon } from "@neondatabase/serverless";
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
const sql = neon(process.env.DATABASE_URL);
await sql.transaction([
  sql`CREATE TABLE IF NOT EXISTS ballast_cache (key text PRIMARY KEY,payload jsonb,refresh_after timestamptz NOT NULL DEFAULT now(),lease_until timestamptz NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS ballast_accounts (privy_id text PRIMARY KEY,email text NOT NULL,address text NOT NULL UNIQUE,encrypted_key text NOT NULL,submit_lock uuid,submit_lock_at timestamptz,faucet_at timestamptz,created_at timestamptz NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS ballast_operations (id uuid PRIMARY KEY,user_id text NOT NULL REFERENCES ballast_accounts(privy_id),idempotency_key uuid NOT NULL,kind text NOT NULL,status text NOT NULL DEFAULT 'preparing',tx_hash text,execution text NOT NULL DEFAULT 'pending',error text,nonce integer,votes jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,idempotency_key))`,
  sql`CREATE INDEX IF NOT EXISTS ballast_operations_user_created ON ballast_operations(user_id,created_at DESC)`,
  sql`CREATE TABLE IF NOT EXISTS ballast_rate_limits (user_id text NOT NULL,window_start timestamptz NOT NULL,hits integer NOT NULL,PRIMARY KEY(user_id,window_start))`,
]);
console.log("Ballast tables and indexes are ready.");
