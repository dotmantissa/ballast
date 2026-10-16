import { expect, it, vi } from "vitest";
const model=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("../../lib/server/chain",()=>({addresses:{underwriting:"0x"+"f".repeat(40)},chainClient:()=>({readContract:model.read})}));
import { legacyCapital, previousPool } from "../../lib/server/legacy-capital";
import { TransactionHashVariant } from "genlayer-js/types";
it("reads actual earlier account holdings at finalized state and returns an allowlist",async()=>{
  model.read.mockResolvedValueOnce({junior_shares:"15",junior_value:"15",senior_shares:"0",senior_value:"0",credit:"1",irrelevant:"hidden"});
  const result=await legacyCapital("0x"+"1".repeat(40));
  expect(model.read).toHaveBeenCalledWith(expect.objectContaining({address:previousPool,functionName:"get_account",transactionHashVariant:TransactionHashVariant.LATEST_FINAL}));
  expect(result?.junior_value).toBe("15");expect(result).not.toHaveProperty("irrelevant");
});
it("returns an explicit outage instead of fabricating zero earlier capital",async()=>{
  model.read.mockRejectedValueOnce(Error("Network unavailable"));
  expect(await legacyCapital("0x"+"1".repeat(40))).toEqual({address:previousPool,available:false});
});
