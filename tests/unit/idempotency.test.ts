import { it, expect } from "vitest";
import { findingRequestKey } from "../../lib/idempotency";
import { z } from "zod";
it("uses the same valid request key after reload and a different key after an appeal", async () => {
  const a = await findingRequestKey("a".repeat(24), "harm", 0);
  const b = await findingRequestKey("a".repeat(24), "harm", 0);
  expect(a).toBe(b);
  expect(z.uuid().safeParse(a).success).toBe(true);
  expect(await findingRequestKey("a".repeat(24), "scope", 0)).not.toBe(a);
  expect(await findingRequestKey("a".repeat(24), "harm", 1)).not.toBe(a);
});
it("separates deployments and effective evidence revisions", async () => {
  const first = await findingRequestKey(
    "a".repeat(24),
    "harm",
    "0:source-a",
    "court-a",
  );
  expect(
    await findingRequestKey("a".repeat(24), "harm", "0:source-a", "court-b"),
  ).not.toBe(first);
  expect(
    await findingRequestKey("a".repeat(24), "harm", "0:source-b", "court-a"),
  ).not.toBe(first);
});
