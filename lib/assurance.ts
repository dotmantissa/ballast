export const ASSURANCE_FIELDS = ["scope_clarity", "spending_controls", "behavior"] as const;
export type AssuranceField = (typeof ASSURANCE_FIELDS)[number];
export type AssuranceValue = "supported" | "contradicted" | "insufficient";
export const ASSURANCE_LABELS: Record<AssuranceField, string> = {
  scope_clarity: "Scope clarity",
  spending_controls: "Spending controls",
  behavior: "Observed behavior",
};
export type Assessment = {
  id: string;
  agent_id: string;
  operator: string;
  executor_address: string;
  manifest_hash: string;
  revision: number;
  rubric_version: string;
  created_at: number;
  valid_until: number;
  review_deadline: number;
  challenge_until: number;
  finalized_at?: number;
  status: "reviewing" | "challenge" | "final" | "disputed" | "evidence_timeout";
  findings: Partial<Record<AssuranceField, AssuranceValue>>;
  reasons: Partial<Record<AssuranceField, string>>;
  source_digests: Partial<Record<AssuranceField, Record<string, string>>>;
  evidence_urls: string[];
  effective_evidence_urls: string[];
  challenges: {
    field: AssuranceField;
    kind: "public" | "operator";
    by: string;
    before: AssuranceValue;
    after?: AssuranceValue;
    changed?: boolean;
    reason: string;
    evidence_urls: string[];
    status: "pending" | "resolved" | "refunded";
    bond: string;
    at: number;
  }[];
};
export type Passport = {
  agent_id: string;
  assessment: Assessment | null;
  final_assessment: Assessment | null;
  ready: boolean;
  monitoring: boolean;
  rubric_version: string;
};
export type MonitoringSubscription = {
  agent_id: string;
  deployment_id: string;
  status: "active" | "paused" | "pending" | "disabled";
  last_checked_at: string | null;
  next_review_at: string | null;
  pause_reason: string | null;
};
export function passportStatus(passport: Passport | null, now = Date.now() / 1000) {
  if (!passport?.assessment) return "Unassessed";
  const assessment = passport.assessment;
  if (assessment.status === "disputed") return "Disputed";
  if (assessment.status === "evidence_timeout") return "Evidence incomplete";
  if (assessment.status === "reviewing") return "Under review";
  if (assessment.status === "challenge") return "Challenge window";
  if (assessment.valid_until <= now) return "Stale";
  return passport.ready ? "Finalized" : "Confirmation pending";
}
