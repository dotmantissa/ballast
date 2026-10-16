"use client";
import { History, ExternalLink } from "lucide-react";
import type { LegacyCapital } from "@/lib/types";
import type { Action } from "@/lib/validation";
import { gen } from "@/lib/format";
export function LegacyCapitalPanel({capital,busy,onAction}:{capital?:LegacyCapital|null;busy:boolean;onAction:(action:Action)=>void}){
  if(!capital)return null;
  if(capital.available && [capital.junior_shares,capital.senior_shares,capital.credit].every(v=>BigInt(v??"0")===0n))return null;
  return <section className="reserve-panel legacy-capital" aria-label="Earlier pool capital">
    <div className="section-heading"><div><h2><History size={20}/> Your earlier capital is still here.</h2><p>New cover uses the revised contracts. Your earlier pool position stays yours. Redeem it here, then withdraw the resulting credit. Funds move only when you ask.</p></div><a className="text-button" href={`https://explorer-studio.genlayer.com/address/${capital.address}`} target="_blank" rel="noreferrer">Earlier pool <ExternalLink size={15}/></a></div>
    {!capital.available?<p role="status">The earlier pool could not be reached. Your position has not been reported as zero. Refresh your account to try again.</p>:<>
      <div className="legacy-positions">{(["junior","senior"] as const).map(tranche=><div key={tranche}><span>{tranche==="junior"?"Junior":"Senior"} position</span><strong className="mono">{gen(capital[`${tranche}_value`])} GEN</strong><button className="button secondary small" disabled={busy||BigInt(capital[`${tranche}_shares`]??"0")===0n} onClick={()=>onAction({kind:"redeem_legacy",tranche,shares:capital[`${tranche}_shares`]!})}>Redeem earlier {tranche} shares</button></div>)}<div><span>Ready to withdraw</span><strong className="mono">{gen(capital.credit)} GEN</strong><button className="button primary small" disabled={busy||BigInt(capital.credit??"0")===0n} onClick={()=>onAction({kind:"withdraw_legacy"})}>Withdraw earlier pool credit</button></div></div>
      <p>These actions use the earlier pool’s rules. Its contract checks available backing before redemption. Existing shares do not buy a position in the new pool.</p>
    </>}
  </section>;
}
