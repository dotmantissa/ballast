"use client";
import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  LockKeyhole,
  LoaderCircle,
  FileText,
  ShieldCheck,
  Coins,
  Scale,
  ExternalLink,
} from "lucide-react";
import type {
  Account,
  Agent,
  Policy,
  Quote,
  Claim,
  Finding,
} from "@/lib/types";
import type { Action } from "@/lib/validation";
import { actionSchema } from "@/lib/validation";
import { gen, short, explorer } from "@/lib/format";
import { EvidenceLink } from "./evidence-link";
import { redeemableShares } from "@/lib/claims";
import { Dialog } from "./dialog";

export type FormTarget =
  | { type: "register" }
  | { type: "revise"; agent: Agent }
  | { type: "authorize" }
  | { type: "evidence"; claim: Claim }
  | { type: "quote"; agent: Agent }
  | { type: "bind"; quote: Quote }
  | { type: "stake"; tranche?: "junior" | "senior" }
  | { type: "redeem"; tranche: "junior" | "senior" }
  | { type: "claim"; policy?: Policy }
  | { type: "appeal"; claim: Claim; finding: Finding }
  | { type: "account" }
  | { type: "agent"; agent: Agent };
const titles: Record<FormTarget["type"], string> = {
  register: "Put your agent on the record",
  revise: "Write the next scope",
  authorize: "Choose an operator",
  evidence: "Give the court another source",
  quote: "Find your footing",
  bind: "A little peace of mind",
  stake: "Put some weight behind it",
  redeem: "Make room to move",
  claim: "Tell us what happened",
  appeal: "Give this finding another look",
  account: "Your Ballast account",
  agent: "The original promise",
};
const descriptions: Partial<Record<FormTarget["type"], string>> = {
  evidence:
    "Add reachable corroboration. Earlier evidence stays on the record and the review deadline stays put.",
  revise:
    "Your executor keeps its identity. Existing cover must close first, and older manifests remain public.",
  authorize:
    "Let another operator register this account as an executor. Once registered, that assignment is fixed.",
  register:
    "A clear scope makes a fair decision possible. This record is permanent.",
  quote:
    "Validators will read your scope, operating history and peer evidence.",
  bind: "Review the numbers. Your cover starts when the network finalizes it.",
  stake: "Your capital backs real decisions on this Studio pool.",
  redeem: "Reserved capital stays put until its cover is released.",
  claim:
    "Evidence speaks louder than a bad day. Help the court see the whole picture.",
  appeal: "Challenge one finding. The other findings stay on the record.",
};
const urls = (raw: FormDataEntryValue | null) =>
  String(raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

export function ActionForm({
  target,
  account,
  policies,
  onClose,
  onSubmit,
  onQuote,
  onNavigate,
}: {
  onNavigate: (target: FormTarget) => void;
  target: FormTarget;
  account: Account | null;
  policies: Policy[];
  onClose: () => void;
  onSubmit: (action: Action) => Promise<void>;
  onQuote: (agent: Agent) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [tranche, setTranche] = useState<"junior" | "senior">(
    target.type === "stake" ? (target.tranche ?? "junior") : "junior",
  );
  const [policyId, setPolicyId] = useState(
    target.type === "claim" ? (target.policy?.id ?? "") : "",
  );
  const [policyPreview, setPolicyPreview] = useState<Policy | null>(
    target.type === "claim" ? (target.policy ?? null) : null,
  );
  async function checkPolicy() {
    setError("");
    setBusy(true);
    try {
      const response = await fetch(
        "/api/records?kind=policies&id=" + encodeURIComponent(policyId),
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setPolicyPreview(data.record);
    } catch (error) {
      setPolicyPreview(null);
      setError(
        error instanceof Error
          ? error.message
          : "We could not check that policy.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    let action: unknown;
    const consent = form.get("consent") === "on";
    switch (target.type) {
      case "register":
        action = {
          kind: "register",
          manifest: String(form.get("manifest")),
          historyUrls: urls(form.get("history")),
          publicConsent: consent,
        };
        break;
      case "revise":
        action = {
          kind: "revise",
          agentId: target.agent.id,
          manifest: String(form.get("manifest")),
          historyUrls: urls(form.get("history")),
          publicConsent: consent,
        };
        break;
      case "authorize":
        action = { kind: "authorize", operator: String(form.get("operator")) };
        break;
      case "evidence":
        action = {
          kind: "evidence",
          claimId: target.claim.id,
          evidenceUrls: urls(form.get("evidence")),
          publicConsent: consent,
        };
        break;
      case "quote":
        action = {
          kind: "quote",
          agentId: target.agent.id,
          limit: String(form.get("amount")),
          peerUrls: urls(form.get("peers")),
        };
        break;
      case "bind":
        action = { kind: "bind", quoteId: target.quote.id };
        break;
      case "stake":
        action = { kind: "stake", tranche, amount: String(form.get("amount")) };
        break;
      case "redeem": {
        const owned = BigInt(
          account?.[
            (target.tranche + "_shares") as "junior_shares" | "senior_shares"
          ] ?? "0",
        );
        const percent = BigInt(String(form.get("percent")));
        action = {
          kind: "redeem",
          tranche: target.tranche,
          shares: (
            (redeemableShares(
              owned.toString(),
              account?.[
                (target.tranche + "_value") as "junior_value" | "senior_value"
              ] ?? "0",
              account?.[
                (target.tranche + "_available") as
                  "junior_available" | "senior_available"
              ] ?? "0",
            ) *
              percent) /
            100n
          ).toString(),
        };
        break;
      }
      case "claim":
        action = {
          kind: "claim",
          policyId: String(form.get("policy")),
          incidentRef: String(form.get("reference")),
          incidentAt: Math.floor(
            new Date(String(form.get("occurred"))).getTime() / 1000,
          ),
          amount: String(form.get("amount")),
          statement: String(form.get("statement")),
          evidenceUrls: urls(form.get("evidence")),
          publicConsent: consent,
        };
        break;
      case "appeal":
        action = {
          kind: "appeal",
          claimId: target.claim.id,
          finding: target.finding,
          reason: String(form.get("reason")),
          evidenceUrls: urls(form.get("evidence")),
          publicConsent: consent,
        };
        break;
      default:
        return;
    }
    const parsed = actionSchema.safeParse(action);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (target.type === "register" || target.type === "revise") {
      try {
        const manifest = JSON.parse(String(form.get("manifest")));
        if (
          !manifest.name ||
          typeof manifest.scope !== "string" ||
          manifest.scope.length < 20 ||
          !/^0x[0-9a-f]{40}$/i.test(manifest.executor_address) ||
          !Number.isInteger(manifest.spend_limit_gen) ||
          manifest.spend_limit_gen < 0 ||
          manifest.spend_limit_gen > 100
        )
          throw Error();
      } catch {
        setError(
          "Include a name, a detailed scope, a valid executor address and a whole number spend_limit_gen from 0 to 100.",
        );
        return;
      }
    }
    setBusy(true);
    try {
      await onSubmit(parsed.data);
      onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (target.type === "agent")
    return (
      <Dialog
        title={target.agent.name}
        description="The exact scope registered before cover."
        onClose={onClose}
      >
        <div className="form-body">
          <dl className="detail-list">
            <div>
              <dt>Manifest hash</dt>
              <dd className="mono break">{target.agent.manifest_hash}</dd>
            </div>
            <div>
              <dt>Executor</dt>
              <dd className="mono break">{target.agent.executor_address}</dd>
            </div>
            <div>
              <dt>Operator</dt>
              <dd className="mono break">{target.agent.operator}</dd>
            </div>
          </dl>
          <pre className="manifest-preview">
            {JSON.stringify(JSON.parse(target.agent.manifest), null, 2)}
          </pre>
          <h3>Public operating history</h3>
          {target.agent.history_urls.map((url) => (
            <EvidenceLink key={url} url={url} compact />
          ))}
          {account?.address.toLowerCase() ===
            target.agent.operator.toLowerCase() && (
            <button
              className="button secondary full"
              onClick={() =>
                onNavigate({ type: "revise", agent: target.agent })
              }
            >
              Revise the scope after cover closes
            </button>
          )}
          <button
            className="button primary full"
            onClick={() => onQuote(target.agent)}
          >
            Request a quote
          </button>
        </div>
      </Dialog>
    );
  if (target.type === "account")
    return (
      <Dialog title={titles.account} onClose={onClose}>
        <div className="form-body">
          <p>{account?.email}</p>
          <div className="account-balance">
            <span>Available test funds</span>
            <strong className="mono">
              {gen(account?.balance)} <small>GEN</small>
            </strong>
          </div>
          <p className="muted">
            An account is created for your email. Ballast holds an encrypted
            signing key and submits only the actions you request. Keep real
            assets away from this experimental account.
          </p>
          <label>
            Your public Studio address
            <div className="address-box mono">
              {account?.address}
              <a
                href={explorer("address", account?.address ?? "")}
                target="_blank"
                rel="noreferrer"
                aria-label="Open account in explorer"
              >
                <ExternalLink size={16} />
              </a>
            </div>
          </label>
          <button
            className="button secondary full"
            onClick={() => onNavigate({ type: "authorize" })}
          >
            Authorize an operator for this executor
          </button>
          <AccountAction
            label="Add 25 test GEN"
            action={{ kind: "faucet" }}
            submit={onSubmit}
          />
          <p className="field-note">
            Studio faucet funds are available once every 24 hours. They have no
            monetary value.
          </p>
          <div className="credit-row">
            <span>Pool credit</span>
            <span className="mono">{gen(account?.credit)} GEN</span>
          </div>
          <AccountAction
            label="Withdraw pool credit"
            action={{ kind: "withdraw" }}
            submit={onSubmit}
            disabled={!account || BigInt(account.credit) === 0n}
          />
          <div className="credit-row">
            <span>Returned bond credit</span>
            <span className="mono">{gen(account?.bondCredit)} GEN</span>
          </div>
          <AccountAction
            label="Withdraw bond credit"
            action={{ kind: "withdraw_bonds" }}
            submit={onSubmit}
            disabled={!account || BigInt(account.bondCredit) === 0n}
          />
        </div>
      </Dialog>
    );
  return (
    <Dialog
      title={titles[target.type]}
      description={descriptions[target.type]}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="form-body" aria-busy={busy}>
        {(target.type === "register" || target.type === "revise") && (
          <>
            <label htmlFor="manifest">
              Capability manifest <span>JSON</span>
            </label>
            <textarea
              defaultValue={
                target.type === "revise" ? target.agent.manifest : undefined
              }
              id="manifest"
              name="manifest"
              className="code-input"
              rows={9}
              required
              placeholder={
                '{\n  "name": "Your agent’s name",\n  "scope": "What it can spend, and whose approval it needs",\n  "executor_address": "0x…",\n  "spend_limit_gen": 1\n}'
              }
            />
            <p className="field-note">
              Use the address that actually executes the agent’s actions. Your
              Ballast account is {account?.address}. A different executor must
              authorize your operator account first. Scope should explain
              permissions, approval rules and spending limits. Adding spaces
              will not create a new agent.
            </p>
            <label htmlFor="history">Public action history</label>
            <textarea
              defaultValue={
                target.type === "revise"
                  ? target.agent.history_urls.join("\n")
                  : undefined
              }
              id="history"
              name="history"
              required
              rows={3}
              placeholder="One HTTPS URL per line"
            />
            <p className="field-note">
              One to four explorer pages or verifiable execution records.
              Validators must be able to open them.
            </p>
            <Consent />
          </>
        )}
        {target.type === "authorize" && (
          <>
            <label htmlFor="operator">Operator address</label>
            <input
              id="operator"
              name="operator"
              required
              pattern="0x[a-fA-F0-9]{40}"
              placeholder="0x…"
            />
            <p className="field-note">
              This authorizes registration of your Ballast address as an
              executor. It does not transfer your funds or let the operator sign
              for you.
            </p>
          </>
        )}
        {target.type === "evidence" && (
          <>
            <Evidence />
            <p className="field-note">
              You may add up to twelve supplemental URLs in total. Both parties
              have their own allowance. Existing findings can be challenged
              through an appeal once the four findings are complete.
            </p>
            <Consent />
          </>
        )}
        {target.type === "quote" && (
          <>
            <div className="form-callout">
              <ShieldCheck size={22} />
              <div>
                <strong>{target.agent.name}</strong>
                <p className="mono">
                  Manifest {short(target.agent.manifest_hash, 10)}
                </p>
              </div>
            </div>
            <Amount
              label="Coverage limit"
              amount={amount}
              setAmount={setAmount}
              min="0.1"
            />
            <p className="field-note">
              Between 0.1 and 100 test GEN for 30 days. Quotes remain open for
              one hour.
            </p>
            <label htmlFor="peers">Peer evidence</label>
            <textarea
              id="peers"
              name="peers"
              rows={3}
              required
              placeholder="Public reports about comparable agents and their spending controls"
            />
            <p className="field-note">
              One to three HTTPS URLs. Relevant records help validators price
              the risk honestly.
            </p>
          </>
        )}
        {target.type === "bind" && (
          <>
            <div className="quote-price">
              <span>Premium for 30 days</span>
              <strong className="mono">
                {gen(target.quote.premium)} <small>GEN</small>
              </strong>
              <span className="badge">{target.quote.band} risk</span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Coverage limit</dt>
                <dd className="mono">{gen(target.quote.limit)} GEN</dd>
              </div>
              <div>
                <dt>Peril</dt>
                <dd>Unauthorized spend</dd>
              </div>
              <div>
                <dt>Term</dt>
                <dd>30 days</dd>
              </div>
              <div>
                <dt>Claim window</dt>
                <dd>7 days after expiry</dd>
              </div>
            </dl>
            <div className="form-callout">
              <FileText size={20} />
              <p>{target.quote.reason}</p>
            </div>
            <p className="field-note">
              The full coverage limit is reserved when you bind. The premium is
              paid from your Studio account. Cover depends on the registered
              scope and public evidence.
            </p>
            <label className="checkbox">
              <input type="checkbox" required />I understand this is
              experimental cover with test funds.
            </label>
          </>
        )}
        {target.type === "stake" && (
          <>
            <div className="segmented">
              <button
                type="button"
                className={tranche === "junior" ? "active" : ""}
                onClick={() => setTranche("junior")}
              >
                Junior tranche
              </button>
              <button
                type="button"
                className={tranche === "senior" ? "active" : ""}
                onClick={() => setTranche("senior")}
              >
                Senior tranche
              </button>
            </div>
            <div className="form-callout">
              <Coins size={22} />
              <p>
                {tranche === "junior"
                  ? "Junior capital absorbs losses first. It receives 80% of premiums when both tranches hold capital."
                  : "Senior capital absorbs losses after junior capital is exhausted. It receives 20% of premiums when both tranches hold capital."}
              </p>
            </div>
            <Amount
              label="Capital to contribute"
              amount={amount}
              setAmount={setAmount}
              min="0.01"
            />
            <p className="field-note">
              Available: {gen(account?.balance)} test GEN. Shares reflect the
              current tranche value.
            </p>
            <label className="checkbox">
              <input type="checkbox" required />I understand claims can reduce
              my capital and active cover can delay withdrawals.
            </label>
          </>
        )}
        {target.type === "redeem" && (
          <>
            <div className="form-callout">
              <Coins size={22} />
              <div>
                <strong>
                  {target.tranche === "junior" ? "Junior" : "Senior"} tranche
                </strong>
                <p>
                  {gen(
                    account?.[
                      (target.tranche + "_value") as
                        "junior_value" | "senior_value"
                    ],
                  )}{" "}
                  GEN in your position
                </p>
              </div>
            </div>
            <label htmlFor="percent">How much of your position?</label>
            <select id="percent" name="percent" defaultValue="100">
              <option value="25">25 percent</option>
              <option value="50">50 percent</option>
              <option value="75">75 percent</option>
              <option value="100">All redeemable shares</option>
            </select>
            <p className="field-note">
              Redeeming creates a pool credit. Withdraw that credit from your
              account menu. Each tranche keeps its own policy backing and
              premiums locked. This estimate uses your redeemable position; the
              contract checks it again.
            </p>
          </>
        )}
        {target.type === "claim" && (
          <>
            <p className="field-note">
              Filing starts the four finding review while this workspace is
              open. Come back at any time to resume it.
            </p>
            <label htmlFor="policy">Policy</label>
            <input
              id="policy"
              name="policy"
              list="claim-policy-options"
              value={policyId}
              onChange={(e) => {
                setPolicyId(e.target.value.trim().toLowerCase());
                setPolicyPreview(null);
              }}
              pattern="[a-f0-9]{24}"
              maxLength={24}
              placeholder="Choose or paste a full policy ID"
              required
            />
            <datalist id="claim-policy-options">
              {policies
                .filter((p) => p.status === "active")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {gen(p.remaining)} GEN remaining
                  </option>
                ))}
            </datalist>
            <button
              type="button"
              className="text-button"
              disabled={busy || !/^[a-f0-9]{24}$/.test(policyId)}
              onClick={() => void checkPolicy()}
            >
              Check this policy
            </button>
            <p className="field-note">
              Any policy can be found by its ID, including one outside the
              latest page.
            </p>
            {policyPreview && (
              <p className="field-note" role="status">
                {gen(policyPreview.remaining)} GEN remaining. Cover period:{" "}
                {new Date(policyPreview.starts_at * 1000).toLocaleString()} to{" "}
                {new Date(policyPreview.ends_at * 1000).toLocaleString()}.
                Status: {policyPreview.status}.
              </p>
            )}
            <div className="form-columns">
              <div>
                <label htmlFor="reference">Studio transaction hash</label>
                <input
                  id="reference"
                  name="reference"
                  required
                  minLength={66}
                  maxLength={66}
                  pattern="0[xX][a-fA-F0-9]{64}"
                  placeholder="0x followed by the 64 character transaction hash"
                />
              </div>
              <div>
                <label htmlFor="occurred">When did it happen?</label>
                <input
                  id="occurred"
                  name="occurred"
                  type="datetime-local"
                  required
                />
              </div>
            </div>
            <Amount
              label="Your evidenced loss"
              amount={amount}
              setAmount={setAmount}
            />
            <label htmlFor="statement">What happened?</label>
            <textarea
              id="statement"
              name="statement"
              rows={4}
              required
              minLength={40}
              maxLength={6000}
              placeholder="Explain what the agent did, why it lacked permission, and how you were harmed."
            />
            <Evidence />
            <div className="form-callout">
              <Scale size={20} />
              <p>
                Filing bond:{" "}
                {amount
                  ? Math.max(0.01, Number(amount) / 100).toLocaleString("en", {
                      maximumFractionDigits: 6,
                    })
                  : "0.01 minimum"}{" "}
                GEN. A successful claim returns it. An adjudicated rejection
                awards it to the operator. An unresolved timeout or withdrawal
                returns it to you.
              </p>
            </div>
            <Consent />
          </>
        )}
        {target.type === "appeal" && (
          <>
            <div className="form-callout">
              <Scale size={20} />
              <p>
                You are appealing the{" "}
                <strong>
                  {target.finding === "scope"
                    ? "declared scope"
                    : target.finding}
                </strong>{" "}
                finding. Bond:{" "}
                {gen(
                  (BigInt(target.claim.amount) / 100n > 10n ** 16n
                    ? BigInt(target.claim.amount) / 100n
                    : 10n ** 16n
                  ).toString(),
                )}{" "}
                GEN.
              </p>
            </div>
            <label htmlFor="reason">What should the court reconsider?</label>
            <textarea
              id="reason"
              name="reason"
              rows={4}
              required
              minLength={40}
              maxLength={4000}
            />
            <Evidence />
            <p className="field-note">
              A changed finding returns your bond. An unchanged finding awards
              it to the other party. Each party keeps one appeal for each
              boolean finding and one payout appeal per eligibility revision.
              The other side cannot spend your appeal. Updated findings open a
              fresh 24 hour window.
            </p>
            <Consent />
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            <AlertCircle size={18} />
            {error}
          </p>
        )}
        <button className="button primary full" type="submit" disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="busy-icon" size={18} />
              Submitting your action
            </>
          ) : target.type === "register" ? (
            "Register manifest"
          ) : target.type === "revise" ? (
            "Register the next manifest revision"
          ) : target.type === "authorize" ? (
            "Authorize this operator"
          ) : target.type === "evidence" ? (
            "Add corroborating evidence"
          ) : target.type === "quote" ? (
            "Request a considered quote"
          ) : target.type === "bind" ? (
            "Pay premium and bind cover"
          ) : target.type === "stake" ? (
            "Contribute capital"
          ) : target.type === "redeem" ? (
            "Redeem shares"
          ) : target.type === "claim" ? (
            "File claim with evidence"
          ) : (
            "Bond and submit appeal"
          )}
        </button>
        <p className="secure-note">
          <LockKeyhole size={13} />
          Submitted securely from your email account
        </p>
      </form>
    </Dialog>
  );
}
function Amount({
  label,
  amount,
  setAmount,
  min = "0.000000000000000001",
}: {
  label: string;
  amount: string;
  setAmount: (s: string) => void;
  min?: string;
}) {
  return (
    <>
      <label htmlFor="amount">{label}</label>
      <div className="amount-input">
        <input
          id="amount"
          name="amount"
          inputMode="decimal"
          type="number"
          min={min}
          max="100"
          step="any"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
        <span>GEN</span>
      </div>
    </>
  );
}
function Consent() {
  return (
    <label className="checkbox">
      <input type="checkbox" name="consent" required />I understand this
      submission and its evidence URLs will be public and permanent. I have
      removed private information and credentials.
    </label>
  );
}
function Evidence() {
  return (
    <>
      <label htmlFor="evidence">Public evidence URLs</label>
      <textarea
        id="evidence"
        name="evidence"
        rows={3}
        required
        placeholder="One HTTPS URL per line, from at least two different hosts"
      />
      <p className="field-note">
        Use authoritative explorer records, verifiable execution receipts or
        public incident logs. A statement alone cannot prove a claim.
      </p>
    </>
  );
}
function AccountAction({
  label,
  action,
  submit,
  disabled,
}: {
  label: string;
  action: Action;
  submit: (a: Action) => Promise<void>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <>
      <button
        className="button secondary full"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            await submit(action);
            setMessage("Submitted. Follow its progress in your activity.");
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Submitting" : label}
      </button>
      {message && (
        <p role="status" className="field-note">
          {message}
        </p>
      )}
    </>
  );
}
