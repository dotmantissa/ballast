import type { Operation } from "./types";
export type SavedOperation = {
  id: string;
  kind: string;
  status: string;
  execution: string;
  tx_hash?: string | null;
  evm_hash?: string | null;
  signed_payload?: string | null;
  has_signed_payload?: boolean;
  attempt?: number;
  updated_at?: string | Date;
  created_at?: string | Date;
  next_retry_at?: string | Date | null;
  error?: string | null;
  votes?: Operation["votes"];
};
// Timeout and undetermined decisions can still be appealed at protocol level.
// Keep polling them; only a terminal receipt permits a fresh transaction.
export const TERMINAL_STATUSES = ["FINALIZED", "CANCELED"];
export function operationRow(row: Record<string, unknown>): SavedOperation {
  for (const key of ["id", "kind", "status", "execution"])
    if (typeof row[key] !== "string") throw Error("Invalid saved activity");
  return row as SavedOperation;
}
export function recoveryState(
  row: SavedOperation,
  now = Date.now(),
): "complete" | "retry" | "reconcile" | "wait" {
  if (row.status === "FINALIZED" && row.execution === "success")
    return "complete";
  if (
    row.tx_hash &&
    (row.status === "CANCELED" ||
      (row.status === "FINALIZED" && row.execution === "error"))
  )
    return "retry";
  if (
    row.status === "error" &&
    !row.tx_hash &&
    !row.evm_hash &&
    !row.signed_payload &&
    !row.has_signed_payload
  )
    return "retry";
  if (
    ["preparing", "submitting"].includes(row.status) &&
    !row.tx_hash &&
    !row.evm_hash &&
    !row.signed_payload &&
    !row.has_signed_payload &&
    now - new Date(row.updated_at ?? now).getTime() > 120000
  )
    return "retry";
  if (
    ["signed", "uncertain"].includes(row.status) ||
    (!row.tx_hash && !!row.evm_hash)
  )
    return "reconcile";
  return "wait";
}
export function retryDelay(attempt: number) {
  return Math.min(300000, 5000 * 2 ** Math.min(6, Math.max(0, attempt - 1)));
}
/** Every API path uses this allowlist; encrypted broadcasts and custody fields stay on the server. */
export function operationView(row: SavedOperation): Operation {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    tx_hash: row.tx_hash ?? null,
    execution: row.execution,
    error: row.error ?? null,
    created_at: new Date(row.created_at ?? Date.now()).toISOString(),
    votes: row.votes ?? [],
    attempt: row.attempt ?? 1,
    next_retry_at: row.next_retry_at
      ? new Date(row.next_retry_at).toISOString()
      : null,
    retryable: recoveryState(row) === "retry",
    needsReconciliation: recoveryState(row) === "reconcile",
  };
}
