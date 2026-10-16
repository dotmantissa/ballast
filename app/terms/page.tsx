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
        Cover applies to an unauthorized debit of a third party’s own native GEN
        funds, caused by the registered executor in a uniquely identified
        top level GenLayer Studio transaction by the insured executor. Child transfer
        receipts cannot identify a second loss. Validators independently establish the
        actual event time, claimant and loss against the policy dates. V1 does
        not cover invoices, missing payments, fiat balances or API credit
        estimates. Maximum cover is 100 test GEN for a 30 day term. Claims must
        be filed within 7 days after that term. Market movement, opportunity
        cost, operator losses and authorized spending are excluded.
      </p>
      <h2>Identity and manifest revisions</h2>
      <p>
        An executor has one stable registry identity. Another operator needs
        that executor’s authorization before registration; the assignment is
        fixed once registered. Manifest formatting does not create another
        agent. Revisions preserve identity and prior records, and existing cover
        must close first. A policy binds its exact manifest revision. One active
        or runoff policy is allowed per executor.
      </p>
      <h2>Quotes and capital</h2>
      <p>
        Quotes expire after one hour. Premiums use a validator agreed risk band
        and recorded loss history. Full limits are reserved when cover binds.
        Each policy receives a junior and senior capital allocation. Its junior
        backing absorbs losses first. Premiums are split 80% to junior and 20%
        to senior when both tranches hold capital; a sole funded tranche
        receives all premiums. Backing and premiums remain locked in their
        allocated tranches until the liability ends. Redemptions preserve those
        locks. Capital can be lost. After a tranche is exhausted, new deposits
        create a separate share generation. Old shares keep zero value and
        cannot dilute new deposits.
      </p>
      <h2>Evidence and recovery</h2>
      <p>
        Claims need public evidence spanning at least two normalized source
        hosts. Harm review also verifies the official finalized Studio record
        for the initiating executor transaction. If that record is unavailable,
        review pauses for retry within the same deadline. An unavailable
        individual supporting source does not prevent review if
        sufficient corroboration remains. Either party may add up to twelve
        supplemental URLs under its own allowance. Appeal evidence stays in the
        effective case record and is retrieved for later assessments.
      </p>
      <p>
        Unfinished review has a fixed seven day deadline. Adding evidence or
        resolving an individual finding does not extend it. A changed
        eligibility finding gives the dependent payout review seven days. Anyone
        can close an overdue unresolved review. The claimant may withdraw an
        unresolved case. Either path returns the filing bond and makes no
        payout; it does not declare that no harm occurred. The finite appeal
        allowances bound a case to at most 70 days of review and challenge time.
        After the policy filing window, excess reserves may be released into
        runoff while unsettled cases retain backing up to their combined requested
        amounts and the remaining policy limit. Closing and settling cases
        releases their unused commitments.
      </p>
      <h2>Compensation and bonds</h2>
      <p>
        Validators assess harm, causation, scope and a payout band. No payout is
        eligible without harm, causation and an established scope breach. One
        claimant may receive one award for the same transaction debit across all
        agents and policies. The pool records cumulative compensation and
        independently checks that payment cannot exceed the evidenced loss or
        remaining cover. Filing requires a bond of 1% of the requested amount,
        with a minimum of 0.01 GEN. A successful award returns it. An
        adjudicated rejection awards it to the operator. A rejected claim leaves
        cover in place; a payment reduces remaining cover. Distinct losses may be
        filed concurrently. All claims share the policy’s aggregate limit.
        Finalized settlements consume remaining cover in settlement order;
        later awards may receive less or zero. An assessed award is not a
        guarantee of payment beyond that shared limit.
      </p>
      <h2>Appeals and settlement</h2>
      <p>
        Each party has one bonded appeal for each boolean finding, plus one
        payout appeal per eligibility revision. One party cannot consume the
        other’s right. The challenge period is 24 hours. The appeal bond is 1%
        of the requested amount, with a minimum of 0.01 GEN. A changed finding
        returns that bond; an upheld finding awards it to the other party. A
        changed boolean or evidenced loss invalidates payout, which must be
        assessed again. Updated findings start a fresh challenge window.
      </p>
      <p>
        Both parties may explicitly accept a complete decision to waive its
        remaining challenge time. Every appeal clears both acceptances. Anyone
        can finalize after the challenge period or mutual acceptance, then
        settle with the pool. Authoritative accounting reads use finalized
        contract storage. A case remains in account recovery records until its
        pool settlement is finalized. Payments and redemptions create credits
        that recipients withdraw.
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
