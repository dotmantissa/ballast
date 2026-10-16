import type { Agent, Claim, Policy, Quote } from "./types";
export const RECORD_KINDS = ["agents", "policies", "claims", "quotes"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export type RecordMap = {
  agents: Agent;
  policies: Policy;
  claims: Claim;
  quotes: Quote;
};
export type RecordPage<T> = {
  items: T[];
  total: number;
  next_cursor: number | null;
};
export type AccountRecords = { [K in RecordKind]: RecordPage<RecordMap[K]> };
export function mergeRecords<T extends { id: string }>(...groups: T[][]): T[] {
  const records = new Map<string, T>();
  for (const group of groups)
    for (const record of group) records.set(record.id, record);
  return [...records.values()];
}
/** Follow the contract's absolute index cursors, including cases outside public pages. */
export async function collectPages<T>(
  first: RecordPage<T>,
  next: (cursor: number) => Promise<RecordPage<T>>,
): Promise<T[]> {
  const items = [...first.items];
  let cursor = first.next_cursor;
  const seen = new Set<number>();
  while (cursor !== null) {
    if (seen.has(cursor)) throw Error("The record cursor did not advance");
    seen.add(cursor);
    const page = await next(cursor);
    items.push(...page.items);
    cursor = page.next_cursor;
  }
  return items;
}
