import { transactionResultNumberToName, executionResultNumberToName } from "genlayer-js/types";

export type ReceiptView = {
  status: string;
  execution: "success" | "error" | "pending";
  votes: { validator: string; vote: string }[];
  error?: string;
};

export function inspectReceipt(raw: unknown): ReceiptView {
  const tx = raw as Record<string, unknown>;
  const consensus = tx.consensus_data as Record<string, unknown> | undefined;
  const receipts = consensus?.leader_receipt;
  // Studio puts the proposed receipt first; extra entries can be idle attempts.
  const leader = (Array.isArray(receipts) ? receipts[0] : receipts) as
    Record<string, unknown> | undefined;
  const status = String(tx.statusName ?? tx.status ?? "PENDING");
  // A leader proposal can succeed and still be rejected by final consensus.
  const outcomes = transactionResultNumberToName as Record<string, string>;
  const executions = executionResultNumberToName as Record<string, string>;
  const outcome = String(tx.resultName ?? tx.result_name ?? outcomes[String(tx.result)] ?? "").toUpperCase();
  const rejected = outcome !== "" && !["MAJORITY_AGREE", "SUCCESS"].includes(outcome);
  const execution = String(
    tx.txExecutionResultName ?? executions[String(tx.txExecutionResult)] ?? leader?.execution_result ?? "",
  ).toUpperCase();
  const decided = /^(ACCEPTED|FINALIZED|CANCELED|UNDETERMINED|LEADER_?TIMEOUT|VALIDATORS_?TIMEOUT)$/.test(status.toUpperCase());
  const failed = decided && (rejected || status.toUpperCase() === "CANCELED" || ["ERROR", "FINISHED_WITH_ERROR", "TIMEOUT", "NONDET_DISAGREE", "DETERMINISTIC_VIOLATION"].includes(execution));
  const votes = consensus?.votes as Record<string, string> | undefined;
  return {
    status,
    execution:
      !decided ? "pending" : failed ? "error" : execution === "SUCCESS" || execution === "FINISHED_WITH_RETURN"
        ? "success" : "pending",
    votes: votes
      ? Object.entries(votes).map(([validator, vote]) => ({
          validator,
          vote: String(vote),
        }))
      : [],
    ...(failed
      ? {
          error: String(
            rejected
              ? "Validators did not agree on this transaction. It did not apply its proposed changes. Check the receipt before retrying."
              : leader?.error ?? "The contract rejected this action. Open its receipt for the execution details.",
          ).slice(0, 700),
        }
      : {}),
  };
}

export function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}
