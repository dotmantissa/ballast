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
  const leader = (Array.isArray(receipts) ? receipts[0] : receipts) as
    Record<string, unknown> | undefined;
  const status = String(tx.statusName ?? tx.status ?? "PENDING");
  const execution = String(
    tx.txExecutionResultName ?? leader?.execution_result ?? "",
  ).toUpperCase();
  const votes = consensus?.votes as Record<string, string> | undefined;
  return {
    status,
    execution:
      execution === "SUCCESS" || execution === "FINISHED_WITH_RETURN"
        ? "success"
        : execution === "ERROR" || execution === "FINISHED_WITH_ERROR"
          ? "error"
          : "pending",
    votes: votes
      ? Object.entries(votes).map(([validator, vote]) => ({
          validator,
          vote: String(vote),
        }))
      : [],
    ...(execution === "ERROR" || execution === "FINISHED_WITH_ERROR"
      ? {
          error: String(
            leader?.error ??
              "The contract rejected this action. Open its receipt for the execution details.",
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
