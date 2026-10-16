import Link from "next/link";
import { Logo } from "@/components/logo";
import { ArrowLeft } from "lucide-react";
export const metadata = { title: "Pool terms" };
export default function Terms() {
  return (
    <main id="main" className="legal-page">
      <Link className="brand" href="/">
        <Logo />
        ballast.
      </Link>
      <h1>A small promise, written clearly.</h1>
      <p>
        Ballast is an experimental discretionary cover pool on the GenLayer
        Studio development network. It is not a regulated insurance product, a
        financial recommendation or a guarantee of compensation. Studio GEN is
        test currency with no monetary value. Studio state can reset.
      </p>
      <h2>The v1 peril</h2>
      <p>
        Cover applies to unauthorized agent spend that causes a realized,
        evidenced loss to a third party during an active 30 day policy. The
        agent’s original registered manifest defines its authority. Maximum
        cover is 100 test GEN. Claims must be filed no later than 7 days after
        the policy ends. Market movement, opportunity cost, operator losses and
        authorized spending are excluded.
      </p>
      <h2>Quotes and capital</h2>
      <p>
        Quotes expire after one hour. Premiums are set by a validator agreed
        risk band and recorded loss history. Full limits are reserved when cover
        binds. Junior capital absorbs losses first. Premiums are split 80% to
        junior and 20% to senior when both tranches hold capital; a sole funded
        tranche receives all premiums. Capital can be lost. Redemptions cannot
        consume reserved funds.
      </p>
      <h2>Evidence and claims</h2>
      <p>
        Claims need public evidence from at least two source hosts. Validators
        independently assess harm, causation, scope and a payout band. No payout
        is eligible without harm, causation and an established scope breach.
        Filing requires a bond of 1% of the requested amount, with a minimum of
        0.01 GEN. Successful claims return that bond; otherwise it goes to the
        operator. A rejected claim leaves cover in place. A payment reduces
        remaining cover.
      </p>
      <h2>Appeals and settlement</h2>
      <p>
        The claimant or operator can challenge one finding at a time during a 24
        hour challenge period. Each finding permits one bonded appeal. The
        appeal bond is 1% of the claim, with a minimum of 0.01 GEN. If the
        finding changes, the appellant receives the bond credit; otherwise the
        other party does. A changed boolean requires the payout finding to be
        assessed again. A fresh challenge period starts once the findings are
        complete. Anyone can finalize after it closes and settle the result with
        the pool. Payouts and redemptions are credits that recipients withdraw.
      </p>
      <h2>Your account and public records</h2>
      <p>
        Email authentication creates a custodial Studio account. The server
        stores its signing key in encrypted form. Ballast submits actions that
        you request. Do not transfer real assets to this experimental account.
        Manifests, claims, evidence URLs and contract records are public and
        permanent for the lifetime of the network. Do not submit credentials or
        private information. The contracts determine the executable rules. The
        code has automated tests but has not received an independent security
        audit.
      </p>
      <Link className="back-link" href="/">
        <ArrowLeft size={16} />
        Back to Ballast
      </Link>
    </main>
  );
}
