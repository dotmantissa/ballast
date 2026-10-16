import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LegacyCapitalPanel } from "../../components/legacy-capital-panel";
import { actionSchema } from "../../lib/validation";
it("shows earlier holdings and explicit separate redemption and withdrawal actions",()=>{
  const html=renderToStaticMarkup(createElement(LegacyCapitalPanel,{capital:{address:"0x"+"1".repeat(40),available:true,junior_shares:"15000000000000000000",junior_value:"15000000000000000000",senior_shares:"0",senior_value:"0",credit:"0"},busy:false,onAction:vi.fn()}));
  expect(html).toContain("15.00");expect(html).toContain("Redeem earlier junior shares");expect(html).toContain("Withdraw earlier pool credit");expect(html).toContain("Funds move only when you ask.");
});
it("never reports an unreachable earlier position as zero",()=>{
  const html=renderToStaticMarkup(createElement(LegacyCapitalPanel,{capital:{address:"0x"+"1".repeat(40),available:false},busy:false,onAction:vi.fn()}));
  expect(html).toContain("could not be reached");expect(html).not.toContain("0.00");
});
it("accepts only bounded withdrawal action shapes for the earlier pool",()=>{
  expect(actionSchema.parse({kind:"redeem_legacy",tranche:"junior",shares:"1",address:"arbitrary"})).toEqual({kind:"redeem_legacy",tranche:"junior",shares:"1"});
  expect(actionSchema.safeParse({kind:"redeem_legacy",tranche:"junior",shares:"-1"}).success).toBe(false);
  expect(actionSchema.safeParse({kind:"stake_legacy",amount:"1"}).success).toBe(false);
});
