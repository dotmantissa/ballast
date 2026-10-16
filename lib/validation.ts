import { z } from "zod";
import { parseUnits } from "viem";

import { normalizePublicUrl, evidenceHost } from "./evidence";
export const publicUrl = z
  .string()
  .max(500)
  .refine(
    (v) => normalizePublicUrl(v) !== null,
    "Use a public HTTPS URL without credentials.",
  )
  .transform((v) => normalizePublicUrl(v)!);
const id = z.string().regex(/^[a-f0-9]{24}$/);
const money = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,2})(\.\d{1,18})?$/,
    "Enter a GEN amount with up to 18 decimal places.",
  )
  .refine((v) => {
    try {
      return parseUnits(v, 18) > 0n && parseUnits(v, 18) <= 100n * 10n ** 18n;
    } catch {
      return false;
    }
  }, "Choose an amount above zero and no more than 100 GEN.");
const sources = z.array(publicUrl).min(1).max(4);
const evidence = z
  .array(publicUrl)
  .min(2)
  .max(6)
  .refine(
    (urls) =>
      urls.every((u) => evidenceHost(u) !== null) &&
      new Set(urls.map(evidenceHost)).size >= 2,
    "Use at least two different evidence hosts.",
  );
export const actionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("register"),
    manifest: z.string().min(30).max(16000),
    historyUrls: sources,
    publicConsent: z.literal(true),
  }),
  z.object({
    kind: z.literal("quote"),
    agentId: id,
    limit: money,
    peerUrls: z.array(publicUrl).min(1).max(3),
  }),
  z.object({ kind: z.literal("bind"), quoteId: id }),
  z.object({
    kind: z.literal("stake"),
    tranche: z.enum(["junior", "senior"]),
    amount: money,
  }),
  z.object({
    kind: z.literal("redeem"),
    tranche: z.enum(["junior", "senior"]),
    shares: z.string().regex(/^[1-9]\d{0,77}$/),
  }),
  z.object({ kind: z.literal("withdraw") }),
  z.object({kind:z.literal("redeem_legacy"),tranche:z.enum(["junior","senior"]),shares:z.string().regex(/^[1-9]\d{0,77}$/)}),
  z.object({kind:z.literal("withdraw_legacy")}),
  z.object({ kind: z.literal("withdraw_bonds") }),
  z.object({
    kind: z.literal("claim"),
    policyId: id,
    incidentRef: z
      .string()
      .regex(/^0x[0-9a-f]{64}$/i, "Use the exact Studio transaction hash.")
      .transform((v) => v.toLowerCase()),
    incidentAt: z.number().int().positive(),
    amount: money,
    statement: z.string().min(40).max(6000),
    evidenceUrls: evidence,
    publicConsent: z.literal(true),
  }),
  z.object({
    kind: z.literal("resolve"),
    claimId: id,
    finding: z.enum(["harm", "causation", "scope", "payout"]),
  }),
  z.object({
    kind: z.literal("appeal"),
    claimId: id,
    finding: z.enum(["harm", "causation", "scope", "payout"]),
    reason: z.string().min(40).max(4000),
    evidenceUrls: evidence,
    publicConsent: z.literal(true),
  }),
  z.object({
    kind: z.literal("evidence"),
    claimId: id,
    evidenceUrls: evidence,
    publicConsent: z.literal(true),
  }),
  z.object({ kind: z.literal("withdraw_claim"), claimId: id }),
  z.object({ kind: z.literal("close_unresolved"), claimId: id }),
  z.object({ kind: z.literal("accept_decision"), claimId: id }),
  z.object({
    kind: z.literal("authorize"),
    operator: z.string().regex(/^0x[0-9a-f]{40}$/i),
  }),
  z.object({
    kind: z.literal("revise"),
    agentId: id,
    manifest: z.string().min(30).max(16000),
    historyUrls: sources,
    publicConsent: z.literal(true),
  }),
  z.object({ kind: z.literal("acknowledge"), claimId: id }),
  z.object({ kind: z.literal("finalize"), claimId: id }),
  z.object({ kind: z.literal("settle"), claimId: id }),
  z.object({ kind: z.literal("sync_loss"), claimId: id }),
  z.object({ kind: z.literal("expire"), policyId: id }),
  z.object({ kind: z.literal("faucet") }),
]);
export type Action = z.infer<typeof actionSchema>;
