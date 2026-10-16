import type { AccountRecords, RecordKind } from "./records";
export type Agent = {
  id: string;
  name: string;
  operator: string;
  manifest: string;
  manifest_hash: string;
  scope: string;
  executor_address: string;
  history_urls: string[];
  registered_at: number;
};
export type Quote = {
  id: string;
  agent_id: string;
  operator: string;
  manifest_hash: string;
  band: string;
  reason: string;
  limit: string;
  premium: string;
  rate_bps: number;
  peer_urls: string[];
  created_at: number;
  expires_at: number;
  bound: boolean;
};
export type Policy = Quote & {
  status: string;
  starts_at: number;
  ends_at: number;
  paid: string;
  remaining: string;
  claim_id: string;
};
export type Finding = "harm" | "causation" | "scope" | "payout";
export type Claim = {
  id: string;
  policy_id: string;
  agent_id: string;
  operator: string;
  claimant: string;
  incident_ref: string;
  incident_at: number;
  amount: string;
  statement: string;
  evidence_urls: string[];
  created_at: number;
  status: string;
  findings: Partial<Record<Finding, boolean | number>>;
  reasons: Partial<Record<Finding, string>>;
  review_deadline: number;
  effective_evidence_urls: string[];
  event_key: string;
  verified_loss: string;
  verified_incident_at: number;
  eligibility_revision: number;
  acceptances: string[];
  outcome?: string;
  challenge_until: number;
  appeals: {
    field: Finding;
    revision: number;
    by: string;
    changed: boolean;
    reason: string;
    evidence_urls: string[];
    before: boolean | number;
    after: boolean | number;
  }[];
  claim_bond: string;
  payout: string;
};
export type Dashboard = {
  registry: string;
  court: string;
  junior: string;
  senior: string;
  junior_supply: string;
  senior_supply: string;
  junior_locked: string;
  senior_locked: string;
  junior_generation: number;
  senior_generation: number;
  reserved: string;
  available: string;
  premiums: string;
  paid: string;
  credits: string;
  tvg: string;
  policy_count: number;
  quote_count: number;
};
export type Overview = {
  cursors: Record<RecordKind, number | null>;
  stale?: boolean;
  dashboard: Dashboard;
  agents: Agent[];
  policies: Policy[];
  claims: Claim[];
  quotes: Quote[];
  agentCount: number;
  claimCount: number;
  updatedAt: string;
  deployment: {
    registry: string;
    underwriting: string;
    court: string;
    network: string;
    chainId: number;
  };
};
export type Operation = {
  attempt?: number;
  next_retry_at?: string | null;
  retryable?: boolean;
  needsReconciliation?: boolean;
  id: string;
  kind: string;
  status: string;
  tx_hash: string | null;
  execution: string;
  error: string | null;
  created_at: string;
  votes: { validator: string; vote: string }[];
};
export type Account = {
  deployment: { court: string; underwriting: string };
  records: AccountRecords;
  unresolvedClaims: Claim[];
  junior_available: string;
  senior_available: string;
  junior_generation: number;
  senior_generation: number;
  address: string;
  balance: string;
  email: string;
  credit: string;
  bondCredit: string;
  junior_shares: string;
  senior_shares: string;
  junior_value: string;
  senior_value: string;
  operations: Operation[];
};
export const FINDINGS: Finding[] = ["harm", "causation", "scope", "payout"];
export const FINDING_LABELS: Record<Finding, string> = {
  harm: "Did harm occur?",
  causation: "Did the agent cause it?",
  scope: "Was it within scope?",
  payout: "What payout is supported?",
};
