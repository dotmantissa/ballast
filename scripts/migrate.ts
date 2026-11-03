import "./db-transport";
import { neon, neonConfig } from "@neondatabase/serverless";
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
neonConfig.fetchEndpoint = (host) => `https://${host}/sql`;
const sql = neon(process.env.DATABASE_URL);
const testSchema=process.env.BALLAST_MIGRATION_SCHEMA;
if(testSchema&&!/^ballast_test_[a-z0-9_]+$/.test(testSchema))throw Error('Only isolated ballast_test_* schemas may be selected');
const prefix=testSchema?[sql.query('CREATE SCHEMA IF NOT EXISTS "'+testSchema+'"'),sql.query('SET LOCAL search_path TO "'+testSchema+'"')]:[];
await sql.transaction([
  ...prefix,
  sql`CREATE TABLE IF NOT EXISTS ballast_cache (key text PRIMARY KEY,payload jsonb,refresh_after timestamptz NOT NULL DEFAULT now(),lease_until timestamptz NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS ballast_accounts (privy_id text PRIMARY KEY,email text NOT NULL,address text NOT NULL UNIQUE,encrypted_key text NOT NULL,submit_lock uuid,submit_lock_at timestamptz,faucet_at timestamptz,created_at timestamptz NOT NULL DEFAULT now())`,
  sql`CREATE TABLE IF NOT EXISTS ballast_operations (id uuid PRIMARY KEY,user_id text NOT NULL REFERENCES ballast_accounts(privy_id),idempotency_key uuid NOT NULL,kind text NOT NULL,status text NOT NULL DEFAULT 'preparing',tx_hash text,execution text NOT NULL DEFAULT 'pending',error text,nonce integer,votes jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,idempotency_key))`,
  sql`ALTER TABLE ballast_operations ADD COLUMN IF NOT EXISTS action_hash text, ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1, ADD COLUMN IF NOT EXISTS evm_hash text, ADD COLUMN IF NOT EXISTS signed_payload text, ADD COLUMN IF NOT EXISTS next_retry_at timestamptz`,
  sql`CREATE TABLE IF NOT EXISTS ballast_operation_attempts (operation_id uuid NOT NULL REFERENCES ballast_operations(id),attempt integer NOT NULL,status text NOT NULL,execution text NOT NULL,tx_hash text,evm_hash text,error text,completed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(operation_id,attempt))`,
  sql`ALTER TABLE ballast_operations ADD COLUMN IF NOT EXISTS deployment_id text, ADD COLUMN IF NOT EXISTS action jsonb`,
  sql`CREATE TABLE IF NOT EXISTS ballast_monitor_slots(id text PRIMARY KEY)`,
  sql`CREATE TABLE IF NOT EXISTS ballast_monitoring(deployment_id text NOT NULL,agent_id text NOT NULL,user_id text NOT NULL REFERENCES ballast_accounts(privy_id),status text NOT NULL DEFAULT 'pending',last_checked_at timestamptz,next_review_at timestamptz,pause_reason text,evidence_digest text,manifest_hash text,loss_count integer,PRIMARY KEY(deployment_id,agent_id))`,
  sql`CREATE TABLE IF NOT EXISTS ballast_sponsor_state(id text PRIMARY KEY,usage_day date NOT NULL DEFAULT current_date,used_count integer NOT NULL DEFAULT 0,lease uuid,lease_until timestamptz)`,
  sql`CREATE TABLE IF NOT EXISTS ballast_jobs(id text PRIMARY KEY,kind text NOT NULL,deployment_id text NOT NULL,target_id text NOT NULL,payload jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'queued',run_id text,pause_reason text,updated_at timestamptz NOT NULL DEFAULT now())`,
  sql`ALTER TABLE ballast_jobs ADD COLUMN IF NOT EXISTS epoch integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS segment integer NOT NULL DEFAULT 0`,
  sql`CREATE INDEX IF NOT EXISTS ballast_jobs_status_updated ON ballast_jobs(status,updated_at)`,
  sql`CREATE INDEX IF NOT EXISTS ballast_operations_user_created ON ballast_operations(user_id,created_at DESC)`,
  sql`CREATE TABLE IF NOT EXISTS ballast_rate_limits (user_id text NOT NULL,window_start timestamptz NOT NULL,hits integer NOT NULL,PRIMARY KEY(user_id,window_start))`,
]);
console.log("Ballast tables and indexes are ready.");
